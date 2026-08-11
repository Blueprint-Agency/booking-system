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

/**
 * The one bucket. Workshop covers, instructor photos and medical certificates
 * all live here.
 *
 * It is served by `R2_PUBLIC_URL`, so ANYTHING written here is readable by
 * anyone who holds the object key — including a certificate. The key is the
 * only thing standing between a health document and the public, which is why
 * `medicalCertKey` uses two UUIDs and why no read path serialises it. The
 * signed URL below still expires, but it guards nothing an unsigned URL would
 * not also reach.
 *
 * Optional, like the rest of the storage settings — an unconfigured deployment
 * refuses the upload at use-site rather than failing to boot. Callers check
 * this is set before calling either helper below.
 */
export const R2_BUCKET = process.env.R2_BUCKET_NAME

export const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

/** A signed GET, valid for `expiresIn` seconds. Generated per request, never
 *  stored. On a public bucket this is a courtesy, not a boundary — see above. */
export function signedObjectUrl(key: string, expiresIn: number): Promise<string> {
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), {
    expiresIn,
  })
}
