import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  Landmark,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";

interface PlaidStatus {
  configured: boolean;
  environment: "sandbox" | "production" | "invalid";
  products: string[];
  message?: string;
}

interface PlaidAccount {
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
  currency: string | null;
}

interface PlaidHolding {
  accountName: string;
  symbol: string | null;
  securityName: string;
  quantity: number;
  marketValue: number | null;
  institutionPrice: number | null;
  costBasis: number | null;
  currency: string | null;
}

interface PlaidTransaction {
  date: string;
  name: string;
  symbol: string | null;
  type: string;
  subtype: string | null;
  amount: number;
  quantity: number | null;
  price: number | null;
}

interface PlaidItem {
  itemId: string;
  institutionName: string;
  products: string[];
  connectedAt: string;
  lastSyncedAt: string | null;
  retrievedAt: string | null;
  status: "connected" | "error";
  requiresReauth: boolean;
  errorMessage?: string;
  accounts: PlaidAccount[];
  holdings: PlaidHolding[];
  transactions: PlaidTransaction[];
  transactionsAvailable: boolean;
}

function formatMoney(value: number | null, currency: string | null = "USD") {
  if (value === null || !Number.isFinite(value)) return "Not provided";
  const safeCurrency = currency && /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: safeCurrency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

export default function PlaidAccountsPanel() {
  const { toast } = useToast();
  const [status, setStatus] = useState<PlaidStatus | null>(null);
  const [items, setItems] = useState<PlaidItem[]>([]);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [disconnectingItemId, setDisconnectingItemId] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [reconnectingItemId, setReconnectingItemId] = useState<string | null>(null);
  const [linkPurpose, setLinkPurpose] = useState<"investments" | "spending">("investments");

  const refreshAccounts = useCallback(async (showToast = false) => {
    setIsLoading(true);
    setLoadError("");
    try {
      const statusResponse = await apiRequest("GET", "/api/plaid/status");
      const nextStatus = await statusResponse.json() as PlaidStatus;
      setStatus(nextStatus);
      if (!nextStatus.configured) {
        setItems([]);
        return;
      }

      const response = await apiRequest("GET", "/api/plaid/accounts");
      const data = await response.json() as { items: PlaidItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
      // Linking or removing an account changes every reconciled total.
      void queryClient.invalidateQueries({ queryKey: ["/api/finances/overview"] });
      if (showToast) {
        toast({ title: "Investment accounts refreshed" });
      }
    } catch {
      setLoadError("Could not load connected investment accounts. Try again.");
      if (showToast) {
        toast({
          title: "Refresh failed",
          description: "Could not load connected investment accounts.",
          variant: "destructive",
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void refreshAccounts();
  }, [refreshAccounts]);

  const handleLinkSuccess = useCallback(async (
    publicToken: string | null,
    metadata: { institution: null | { institution_id: string; name: string } }
  ) => {
    try {
      // Update mode (reconnect) keeps the existing access token; Plaid says not to exchange.
      if (publicToken && !reconnectingItemId) {
        await apiRequest("POST", "/api/plaid/exchange-token", {
          publicToken,
          purpose: linkPurpose,
          ...(metadata.institution
            ? {
                institution: {
                  id: metadata.institution.institution_id,
                  name: metadata.institution.name,
                },
              }
            : {}),
        });
      }
      await refreshAccounts();
      toast({
        title: reconnectingItemId
          ? "Account access updated"
          : linkPurpose === "spending"
            ? "Bank account connected"
            : "Investment account connected",
      });
    } catch {
      toast({
        title: "Could not save the account connection",
        description: "Please try linking the account again.",
        variant: "destructive",
      });
    } finally {
      setIsBusy(false);
      setPendingOpen(false);
      setReconnectingItemId(null);
      setLinkToken(null);
    }
  }, [linkPurpose, reconnectingItemId, refreshAccounts, toast]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: handleLinkSuccess,
    onExit: (error) => {
      setIsBusy(false);
      setPendingOpen(false);
      setReconnectingItemId(null);
      setLinkToken(null);
      if (error) {
        toast({
          title: "Account linking was not completed",
          description: "You can try again when you are ready.",
          variant: "destructive",
        });
      }
    },
  });

  useEffect(() => {
    if (pendingOpen && ready) {
      setPendingOpen(false);
      open();
    }
  }, [open, pendingOpen, ready]);

  const beginLink = async (
    purpose: "investments" | "spending" = "investments",
    itemId?: string
  ) => {
    setIsBusy(true);
    setReconnectingItemId(itemId || null);
    setLinkPurpose(purpose);
    try {
      const response = await apiRequest("POST", "/api/plaid/link-token", { purpose, ...(itemId ? { itemId } : {}) });
      const data = await response.json() as { linkToken: string };
      setLinkToken(data.linkToken);
      setPendingOpen(true);
    } catch {
      setIsBusy(false);
      setReconnectingItemId(null);
      toast({
        title: "Could not start Plaid Link",
        description: "Check the Sandbox setup and try again.",
        variant: "destructive",
      });
    }
  };

  const disconnect = async (itemId: string) => {
    setDisconnectingItemId(itemId);
    try {
      const response = await apiRequest("POST", "/api/plaid/disconnect", { itemId });
      const result = await response.json() as {
        providerRevocationConfirmed: boolean;
      };
      await refreshAccounts();
      toast(result.providerRevocationConfirmed
        ? { title: "Investment account disconnected" }
        : {
            title: "Removed from InvestSmart",
            description: "Plaid could not confirm revocation. You may also need to revoke access with the institution.",
          });
    } catch {
      toast({
        title: "Could not disconnect the account",
        description: "Try again later.",
        variant: "destructive",
      });
    } finally {
      setDisconnectingItemId(null);
    }
  };

  const hasConnectedItem = items.some((item) => item.status === "connected");

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Landmark className="h-5 w-5 text-indigo-600" />
              Connected financial accounts
            </CardTitle>
            <p className="mt-1 text-sm text-gray-500">
              Connect a brokerage for holdings or a bank account for spending.
            </p>
          </div>
          {status?.environment === "sandbox" && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
              Sandbox
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading && (
          <div className="flex items-center gap-2 py-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading linked accounts
          </div>
        )}

        {!isLoading && status && !status.configured && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {status.message || "Plaid Sandbox setup is not complete yet."}
          </div>
        )}

        {loadError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {status?.configured && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void beginLink("investments")} disabled={isBusy || isLoading}>
              {isBusy && !reconnectingItemId && linkPurpose === "investments"
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Link2 className="mr-2 h-4 w-4" />}
              Connect investment account
            </Button>
            {status.products.includes("transactions") && (
              <Button
                variant="outline"
                onClick={() => void beginLink("spending")}
                disabled={isBusy || isLoading}
              >
                {isBusy && !reconnectingItemId && linkPurpose === "spending"
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Link2 className="mr-2 h-4 w-4" />}
                Connect bank account for spending
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => void refreshAccounts(true)}
              disabled={isLoading || isBusy}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        )}

        {!isLoading && status?.configured && items.length === 0 && (
          <p className="text-sm text-gray-500">
            No financial accounts are connected yet.
          </p>
        )}

        {items.map((item) => (
          <section key={item.itemId} className="rounded-lg border border-gray-200 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-gray-900">{item.institutionName}</h3>
                <p className="mt-1 text-xs text-gray-500">
                  {item.retrievedAt
                    ? `Retrieved ${new Date(item.retrievedAt).toLocaleString()}`
                    : item.lastSyncedAt
                      ? `Last retrieved ${new Date(item.lastSyncedAt).toLocaleString()}`
                      : `Connected ${new Date(item.connectedAt).toLocaleDateString()}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {item.requiresReauth && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => void beginLink(
                      item.products.includes("transactions") ? "spending" : "investments",
                      item.itemId
                    )}
                  >
                    {isBusy && reconnectingItemId === item.itemId
                      ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
                    Reconnect
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disconnectingItemId === item.itemId}
                  onClick={() => void disconnect(item.itemId)}
                  className="text-gray-600"
                >
                  {disconnectingItemId === item.itemId
                    ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    : <Unplug className="mr-1 h-3.5 w-3.5" />}
                  Disconnect
                </Button>
              </div>
            </div>

            {item.status === "error" && (
              <div className="mt-3 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
                {item.errorMessage}
              </div>
            )}

            {item.accounts.length > 0 && (
              <div className="mt-3 space-y-2">
                {item.accounts.map((account, index) => (
                  <div
                    key={`${account.name}-${index}`}
                    className="flex items-center justify-between gap-3 rounded-md bg-gray-50 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-800">{account.name}</p>
                      <p className="text-xs capitalize text-gray-500">
                        {account.subtype || account.type}
                        {account.mask ? ` ···· ${account.mask}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-gray-900">
                        {formatMoney(account.currentBalance, account.currency)}
                      </p>
                      {account.availableBalance !== null && (
                        <p className="text-xs text-gray-500">
                          Available {formatMoney(account.availableBalance, account.currency)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {item.holdings.length > 0 && (
              <div className="mt-4">
                <h4 className="mb-2 text-sm font-semibold text-gray-800">Holdings</h4>
                <div className="space-y-2">
                  {item.holdings.map((holding, index) => (
                    <div
                      key={`${holding.symbol || holding.securityName}-${index}`}
                      className="flex items-center justify-between gap-3 border-b border-gray-100 pb-2 text-sm last:border-0"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">
                          {holding.symbol || holding.securityName}
                        </p>
                        <p className="truncate text-xs text-gray-500">
                          {holding.securityName} · {holding.quantity.toLocaleString()} shares
                        </p>
                      </div>
                      <p className="shrink-0 font-medium text-gray-900">
                        {formatMoney(holding.marketValue, holding.currency)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {item.status === "connected"
              && item.products.includes("investments")
              && item.holdings.length === 0 && (
              <p className="mt-3 text-sm text-gray-500">
                No investment holdings were returned for this account.
              </p>
            )}

            {item.products.includes("investments")
              && item.transactionsAvailable
              && item.transactions.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold text-gray-800">
                  Recent investment transactions
                </summary>
                <div className="mt-2 space-y-2">
                  {item.transactions.slice(0, 10).map((transaction, index) => (
                    <div
                      key={`${transaction.date}-${transaction.name}-${index}`}
                      className="flex items-start justify-between gap-3 border-b border-gray-100 pb-2 text-sm last:border-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-gray-800">
                          {transaction.symbol || transaction.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {transaction.date} · {transaction.subtype || transaction.type}
                        </p>
                      </div>
                      <p className="shrink-0 text-gray-700">{formatMoney(transaction.amount)}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {item.status === "connected"
              && item.products.includes("investments")
              && !item.transactionsAvailable && (
              <p className="mt-3 text-xs text-gray-500">
                Investment transaction history is not available for this institution.
              </p>
            )}
          </section>
        ))}

        {hasConnectedItem && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs leading-5 text-indigo-900">
            <p>
              As described in the{" "}
              <a href="/terms#ai-sharing" target="_blank" rel="noopener noreferrer" className="font-medium underline">
                Terms and Conditions
              </a>
              , AI analysis includes ticker symbols, share counts, and institution-reported values from linked
              investment accounts, plus a cash-flow summary from linked bank accounts. Account numbers, merchant
              names, individual transactions, and Plaid credentials are never sent. Disconnect an account to stop
              including it.
            </p>
            <p className="mt-2 flex items-center gap-1 text-indigo-800">
              <ShieldCheck className="h-3.5 w-3.5" />
              Plaid access tokens stay encrypted on the server.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
