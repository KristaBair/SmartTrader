// Stores uploaded brokerage screenshots in S3 under the uploader's own prefix.
// The bucket is private, encrypted at rest, and expires uploads automatically
// (see infra/smarttrader.yaml), so screenshots are not kept indefinitely.

import { randomUUID } from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { awsConfig, s3 } from "../aws";

export async function saveScreenshot(userId: string, body: Buffer, mimeType: string): Promise<string> {
  const extension = mimeType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";
  const key = `screenshots/${userId}/${randomUUID()}.${extension}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: awsConfig.bucketName,
      Key: key,
      Body: body,
      ContentType: mimeType,
      ServerSideEncryption: "AES256",
    })
  );
  return key;
}
