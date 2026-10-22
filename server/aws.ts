// AWS configuration and SDK clients shared by the whole server.
// Credentials come from the standard AWS provider chain (AWS_ACCESS_KEY_ID /
// AWS_SECRET_ACCESS_KEY in Replit Secrets, or an IAM role when hosted on AWS).

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set. See infra/README.md for the AWS setup.`);
  }
  return value;
}

export const awsConfig = {
  region: required("AWS_REGION"),
  tableName: required("DYNAMODB_TABLE"),
  bucketName: required("S3_BUCKET"),
  userPoolId: required("COGNITO_USER_POOL_ID"),
  userPoolClientId: required("COGNITO_CLIENT_ID"),
  // Cross-region inference profile ID. Override to switch models without a code change.
  bedrockModelId: process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-sonnet-4-6",
};

export const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: awsConfig.region }),
  { marshallOptions: { removeUndefinedValues: true } }
);

export const s3 = new S3Client({ region: awsConfig.region });

export const bedrock = new BedrockRuntimeClient({
  region: awsConfig.region,
  maxAttempts: 5,
  retryMode: "adaptive",
});
