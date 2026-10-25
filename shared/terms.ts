// Terms and Conditions shown at account creation and enforced by the server.
// Bump TERMS_VERSION whenever the text changes in a way users must re-accept;
// every signed-in user with an older acceptance is asked to agree again.

// DRAFT pending legal review: 2026-10-25 adds savings pools, goals, planners, and the AI Advisor.
export const TERMS_VERSION = "2026-10-25";
export const TERMS_EFFECTIVE_DATE = "October 25, 2026";
export const SERVICE_NAME = "InvestSmart";
export const TERMS_CONTACT = "krista@kristaswebsites.com";

// A block is either a paragraph or a bulleted list.
export type TermsBlock = string | string[];

export interface TermsSection {
  id: string;
  title: string;
  blocks: TermsBlock[];
}

export const TERMS_SECTIONS: TermsSection[] = [
  {
    id: "agreement",
    title: "1. Agreement to these Terms",
    blocks: [
      `These Terms and Conditions ("Terms") govern your use of ${SERVICE_NAME} (the "Service"), including the website, its AI analysis features, and any financial accounts you connect to it. By creating an account or continuing to use the Service, you agree to these Terms. If you do not agree, do not create an account or use the Service.`,
      "These Terms include how we collect, use, and share your information, including financial information from accounts you connect. Please read them carefully.",
    ],
  },
  {
    id: "eligibility",
    title: "2. Eligibility and your account",
    blocks: [
      [
        "You must be at least 18 years old and able to form a binding contract.",
        "The Service is designed for users in the United States. Account connections are limited to U.S. financial institutions.",
        "You must give accurate sign-up information and keep your password confidential. You are responsible for activity under your account.",
        "Tell us promptly if you believe your account has been accessed without your permission.",
      ],
    ],
  },
  {
    id: "not-advice",
    title: "3. Not financial, investment, tax, or legal advice",
    blocks: [
      `${SERVICE_NAME} provides general information and educational analysis only. We are not a registered investment adviser, broker-dealer, financial planner, tax adviser, or law firm, and nothing in the Service is a recommendation that is personalized to your full financial situation.`,
      [
        "Recommendations, signals, projections, suggested contributions, and spending estimates are informational. They do not consider all of your circumstances, such as unlinked accounts, debts, upcoming expenses, taxes, or goals you have not told us about.",
        "The Service never places trades or moves money. Any decision to buy, sell, save, or spend is yours alone.",
        "Savings pools are labels you put on money you already have. Creating, changing, or deleting a pool never moves money, sells investments, or changes any account, and pools are not added to your net worth.",
        "Financial goals and the emergency fund, rent affordability, and retirement planners are estimates calculated from the information and assumptions shown. They are not guarantees that any amount is affordable or that any goal will be reached.",
        "Investing involves risk, including the loss of principal. Past performance and simulated results do not guarantee future results.",
        "Consider speaking with a qualified, licensed professional before making financial decisions.",
      ],
    ],
  },
  {
    id: "ai",
    title: "4. AI-generated analysis",
    blocks: [
      "The Service uses Anthropic's Claude models, provided through Amazon Bedrock, to generate portfolio analysis, investment suggestions, pattern analysis, chat responses, and to read portfolio screenshots you upload. The AI Advisor uses Claude to answer planning questions from the results of the Service's own calculations about your data.",
      [
        "AI output can be incomplete, out of date, or wrong, even when it sounds confident. Verify important information independently.",
        "Target prices, expected returns, and confidence ratings are the model's own estimates, not facts or statistical probabilities of profit.",
        "We supply the model with verified market quotes where available and remove any price the model states that we could not verify, but we cannot guarantee the accuracy of every statement it makes.",
        "The AI Advisor marks figures that don't match the Service's calculations as not verified and does not recommend buying or selling specific investments. AI Advisor conversations are not stored.",
      ],
    ],
  },
  {
    id: "market-data",
    title: "5. Market data and third-party content",
    blocks: [
      "Quotes, historical prices, and news come from third-party providers (currently Finnhub, Yahoo Finance, and News API). This data may be delayed, interrupted, or inaccurate, and we do not control it. Third-party content and links are provided for convenience and are governed by those parties' own terms.",
    ],
  },
  {
    id: "plaid",
    title: "6. Connecting financial accounts through Plaid",
    blocks: [
      `${SERVICE_NAME} uses Plaid Inc. ("Plaid") to connect to your bank and investment accounts. When you connect an account:`,
      [
        "You sign in to your institution through Plaid's interface. We never see or store your bank or brokerage username or password.",
        "You acknowledge and agree that Plaid will collect, use, and share your information in accordance with the Plaid End User Privacy Policy (https://plaid.com/legal/#end-user-privacy-policy).",
        "You authorize us, through Plaid, to retrieve the following from each connected account: account names, types, and the last four digits of account numbers; current and available balances; investment holdings and securities details; up to 90 days of investment transactions; and, for bank accounts connected for spending, up to 90 days of transactions with amounts, dates, and categories.",
        "You may connect only accounts that you own or are authorized to access.",
        "You can disconnect any account at any time from the dashboard. Disconnecting deletes our stored access credential for that account and asks Plaid to revoke our access. If Plaid cannot confirm revocation, you can also revoke access at your institution or through Plaid Portal (https://my.plaid.com).",
      ],
    ],
  },
  {
    id: "ai-sharing",
    title: "7. Financial information included in AI analysis",
    blocks: [
      "By agreeing to these Terms, you authorize us to include the following in the AI analyses you request, without asking each time. Each request is processed by Claude on Amazon Bedrock:",
      [
        "Information you enter yourself: cash available, holdings and average costs, risk tolerance, timeline, onboarding answers, and chat messages.",
        "From connected investment accounts: ticker symbols, total share counts, and institution-reported holding values.",
        "From connected bank accounts: a summary calculated on our servers, consisting of average monthly income, expenses, and surplus, a suggested monthly contribution, and average monthly spending in your top categories.",
        "Portfolio screenshots you choose to upload.",
      ],
      "When you ask the AI Advisor a question, it may also receive, for the kinds of data you allow in its settings: your net worth and total balances by account type; debts you entered (type, balance, payment, and rate); spending and income totals by type and category, recurring-charge totals, and savings estimates; your savings pools and goals (names, targets, amounts, and projections); and results of the emergency fund, rent, and retirement planners. You can turn each kind of data off in the AI Advisor settings.",
      "The following are never sent to the AI model: full account numbers, Plaid access credentials, institution login details, institution names, merchant names, or individual bank transactions.",
      "Amazon Web Services processes these requests as our service provider. Under AWS's terms for Amazon Bedrock, your prompts and the model's responses are not used to train the underlying models. If you do not want connected-account information included in AI analysis, disconnect those accounts.",
    ],
  },
  {
    id: "data",
    title: "8. Information we store and how we protect it",
    blocks: [
      "We run the Service on Amazon Web Services in the United States:",
      [
        "Amazon Cognito stores your name, email address, and password credentials.",
        "Amazon DynamoDB stores your portfolio, onboarding answers, most recent recommendations, your acceptance of these Terms, and an encrypted Plaid access token for each connected account.",
        "Amazon DynamoDB also stores what you create in the planning features: savings pools and their allocation records (a reference to the account or holding, its display name and last four digits, the amount or number of shares, and a history of changes); financial goals; debts you enter; your choices about whether manual entries duplicate linked accounts; spending categories you change, including the names of merchants you reclassify; expenses and take-home pay you enter; and your AI Advisor settings.",
        "Amazon S3 stores portfolio screenshots you upload.",
      ],
      "Plaid access tokens are encrypted with AES-256-GCM before they are stored. Balances, holdings, and transactions from connected accounts are retrieved from Plaid when you view or analyze them. They are not saved in our database, and raw bank transactions are not stored. To avoid repeated requests, recently retrieved data may be kept in our server's memory for up to 30 seconds. Communication with the Service is encrypted in transit. No system is perfectly secure, and we cannot guarantee absolute security.",
    ],
  },
  {
    id: "sharing",
    title: "9. How we share information",
    blocks: [
      "We do not sell your personal or financial information, and we do not share it for advertising. We share information only:",
      [
        "With service providers that operate the Service for us: Amazon Web Services (sign-in, storage, and AI processing) and Plaid (account connections).",
        "With market data providers, which receive only ticker symbols and search terms needed to look up quotes and news, not your identity or balances.",
        "When required by law, to protect the rights and safety of users or the Service, or with your direction.",
        "In connection with a merger, acquisition, or sale of assets, subject to these Terms or equivalent protections.",
      ],
    ],
  },
  {
    id: "choices",
    title: "10. Your choices",
    blocks: [
      [
        "Disconnect any linked account at any time from the dashboard.",
        "Reset your saved portfolio, onboarding answers, and recommendations from the dashboard.",
        "Edit or delete savings pools, goals, debts you entered, and spending categories at any time.",
        "Choose which kinds of data the AI Advisor may use, in its settings.",
        `To close your account and delete your stored information, contact us at ${TERMS_CONTACT}. We will delete it except where we must keep records to meet a legal obligation.`,
      ],
    ],
  },
  {
    id: "acceptable-use",
    title: "11. Acceptable use",
    blocks: [
      "You agree not to:",
      [
        "Connect accounts you are not authorized to access, or use someone else's information.",
        "Attempt to access other users' data, probe or bypass security, or interfere with the Service.",
        "Scrape, resell, or redistribute the Service, its market data, or AI output for commercial purposes.",
        "Use the Service for unlawful purposes, including fraud or market manipulation.",
        "Upload content that you do not have the right to share or that contains malware.",
      ],
    ],
  },
  {
    id: "availability",
    title: "12. Changes to the Service",
    blocks: [
      "We may add, change, or remove features, including supported institutions and data providers, at any time. Some features may be offered in testing modes that use sample data. We may suspend the Service for maintenance or security reasons.",
    ],
  },
  {
    id: "warranty",
    title: "13. Disclaimer of warranties",
    blocks: [
      'THE SERVICE, INCLUDING ALL DATA, ANALYSIS, AND AI OUTPUT, IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF ACCURACY, MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT, TO THE FULLEST EXTENT PERMITTED BY LAW.',
    ],
  },
  {
    id: "liability",
    title: "14. Limitation of liability",
    blocks: [
      `TO THE FULLEST EXTENT PERMITTED BY LAW, ${SERVICE_NAME.toUpperCase()} AND ITS OPERATORS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR ANY TRADING OR INVESTMENT LOSSES, LOST PROFITS, OR LOST DATA, ARISING FROM YOUR USE OF OR RELIANCE ON THE SERVICE. Some jurisdictions do not allow certain limitations, so some of these may not apply to you.`,
    ],
  },
  {
    id: "indemnity",
    title: "15. Indemnification",
    blocks: [
      "You agree to indemnify and hold harmless the Service's operators from claims arising out of your violation of these Terms or your misuse of the Service.",
    ],
  },
  {
    id: "changes",
    title: "16. Changes to these Terms",
    blocks: [
      "We may update these Terms. If we make changes, we will update the effective date and ask you to review and accept the new Terms before you continue using the Service. If you do not accept, you may disconnect your accounts and stop using the Service.",
    ],
  },
  {
    id: "termination",
    title: "17. Termination",
    blocks: [
      "You may stop using the Service at any time. We may suspend or end your access if you violate these Terms or if needed to protect the Service or other users. Sections 3, 4, 13, 14, and 15 continue to apply after termination.",
    ],
  },
  {
    id: "contact",
    title: "18. Contact",
    blocks: [
      `Questions about these Terms or your information can be sent to ${TERMS_CONTACT}.`,
    ],
  },
];
