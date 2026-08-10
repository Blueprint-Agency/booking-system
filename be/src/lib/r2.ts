import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

export const R2_BUCKET = process.env.R2_BUCKET_NAME!
export const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!

/**
 * The PRIVATE bucket — medical certificates and nothing else so far.
 *
 * Deliberately has no public base URL to pair with it: everything in here is
 * reachable only through a short-lived signed GET, so a leaked or guessed key is
 * not a leaked document. Never serve one of these through `R2_PUBLIC_URL`.
 *
 * Optional, like the rest of the storage settings — an unconfigured deployment
 * refuses the upload at use-site rather than failing to boot. Callers check this
 * is set before calling either helper below.
 */
export const R2_PRIVATE_BUCKET = process.env.R2_PRIVATE_BUCKET_NAME

export async function putPrivateObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_PRIVATE_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

/** A signed GET, valid for `expiresIn` seconds — the only way to read a private
 *  object. Generated per request, never stored. */
export function signedPrivateUrl(key: string, expiresIn: number): Promise<string> {
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_PRIVATE_BUCKET, Key: key }), {
    expiresIn,
  })
}
