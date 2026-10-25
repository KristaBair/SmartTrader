# AWS setup

`smarttrader.yaml` defines the AWS resources used by InvestSmart:

The existing CloudFormation stack, table, bucket, and IAM names retain their
`smarttrader` identifiers for compatibility. Changing deployed resource names
requires a separate migration and is not part of this branding update.

| Resource | Purpose |
|---|---|
| Cognito user pool + web client | Email/password sign-up, email verification, password reset |
| DynamoDB table `smarttrader-data` | Portfolio, onboarding, recommendations, market-data fallback (on-demand, point-in-time recovery) |
| S3 bucket `smarttrader-uploads-<account>-<region>` | Uploaded brokerage screenshots (private, encrypted, TLS-only, expire after 30 days) |
| IAM managed policy `smarttrader-app-server` | Least-privilege access for the server: the table, `PutObject` on `screenshots/*`, and `InvokeModel` on one Bedrock inference profile |

The Cognito pool, table, and bucket use `DeletionPolicy: Retain` and deletion
protection, so deleting the stack does not delete user data.

## 1. Enable the Bedrock model

The account must be able to invoke the model in `BedrockModelId` (default
`us.anthropic.claude-sonnet-4-6`). Confirm the profile exists in your region:

```bash
aws bedrock list-inference-profiles --region us-east-2 \
  --query "inferenceProfileSummaries[?contains(inferenceProfileId, 'claude')].inferenceProfileId"
```

Anthropic models may ask you to submit a one-time use-case form in the Bedrock
console before the first call.

## 2. Deploy the stack

```bash
aws cloudformation deploy \
  --stack-name smarttrader \
  --template-file infra/smarttrader.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-2

aws cloudformation describe-stacks --stack-name smarttrader --region us-east-2 \
  --query "Stacks[0].Outputs" --output table
```

## 3. Give the server credentials

- **Hosted on AWS** (App Runner, ECS, EC2, Lambda): attach the
  `AppServerPolicyArn` output to the service's IAM role. No keys needed.
- **Hosted on Replit**: create an IAM user for the app, attach only the
  `AppServerPolicyArn` policy, create an access key, and store it in Replit
  Secrets as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. Rotate it
  periodically.

## 4. Set Replit Secrets

| Secret | Value |
|---|---|
| `AWS_REGION` | `AwsRegion` output |
| `COGNITO_USER_POOL_ID` | `CognitoUserPoolId` output |
| `COGNITO_CLIENT_ID` | `CognitoClientId` output |
| `DYNAMODB_TABLE` | `DynamoDbTable` output |
| `S3_BUCKET` | `S3Bucket` output |
| `BEDROCK_MODEL_ID` | Optional; must match the stack's `BedrockModelId` parameter |

`OPENAI_API_KEY`, `DATABASE_URL`, `PG*`, and `SESSION_SECRET` are no longer
used and can be deleted.

## Notes

- Cognito's default email sender is limited to a small daily quota. Before
  launch, configure Amazon SES as the user pool's email sender.
- Accounts created under the old on-device profile system lived only in each
  browser's `localStorage`. They are not migrated; users create a Cognito
  account and re-enter their portfolio (or scan a screenshot).
