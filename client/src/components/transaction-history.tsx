import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { History, TrendingUp, TrendingDown } from "lucide-react";
import type { Transaction } from "@shared/schema";

interface TransactionHistoryProps {
  portfolioId?: string;
  userId?: string;
}

export default function TransactionHistory({ portfolioId, userId }: TransactionHistoryProps) {
  const { data: transactions = [], isLoading } = useQuery<Transaction[]>({
    queryKey: portfolioId 
      ? ["/api/portfolios", portfolioId, "transactions"]
      : ["/api/users", userId, "transactions"],
    enabled: !!(portfolioId || userId),
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <History className="text-primary mr-3" />
            Transaction History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-6 w-12" />
                </div>
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <History className="text-primary mr-3" />
          Transaction History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <div className="text-center py-8 text-gray-500" data-testid="empty-transactions">
            <History className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium mb-2">No Transactions Yet</p>
            <p className="text-sm">Your trading activity will appear here once you start making transactions.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {transactions.map((transaction) => (
              <div 
                key={transaction.id} 
                className="border border-gray-200 rounded-lg p-4 hover:border-primary transition-colors"
                data-testid={`transaction-${transaction.symbol.toLowerCase()}-${transaction.id}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-gray-900" data-testid={`text-symbol-${transaction.symbol.toLowerCase()}`}>
                      {transaction.symbol}
                    </h4>
                    <p className="text-sm text-gray-600" data-testid={`text-name-${transaction.symbol.toLowerCase()}`}>
                      {transaction.name}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge 
                      variant={transaction.action === "BUY" ? "default" : "destructive"}
                      className="mb-1"
                      data-testid={`badge-action-${transaction.symbol.toLowerCase()}`}
                    >
                      {transaction.action === "BUY" ? (
                        <TrendingUp className="mr-1 h-3 w-3" />
                      ) : (
                        <TrendingDown className="mr-1 h-3 w-3" />
                      )}
                      {transaction.action}
                    </Badge>
                    <div className="text-xs text-gray-500">
                      {transaction.createdAt ? new Date(transaction.createdAt).toLocaleDateString() : ''}
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Quantity:</span>
                    <span className="font-medium ml-1" data-testid={`text-quantity-${transaction.symbol.toLowerCase()}`}>
                      {parseFloat(transaction.quantity).toFixed(4)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Price:</span>
                    <span className="font-medium ml-1" data-testid={`text-price-${transaction.symbol.toLowerCase()}`}>
                      ${parseFloat(transaction.price).toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Total:</span>
                    <span className={`font-medium ml-1 ${transaction.action === "BUY" ? 'text-red-600' : 'text-green-600'}`} data-testid={`text-total-${transaction.symbol.toLowerCase()}`}>
                      {transaction.action === "BUY" ? '-' : '+'}${parseFloat(transaction.totalAmount).toFixed(2)}
                    </span>
                  </div>
                  {transaction.fees && parseFloat(transaction.fees) > 0 && (
                    <div>
                      <span className="text-gray-600">Fees:</span>
                      <span className="font-medium ml-1 text-red-600" data-testid={`text-fees-${transaction.symbol.toLowerCase()}`}>
                        ${parseFloat(transaction.fees).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
                
                {transaction.notes && (
                  <div className="mt-3 text-sm text-gray-600" data-testid={`text-notes-${transaction.symbol.toLowerCase()}`}>
                    <span className="font-medium">Notes:</span> {transaction.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}