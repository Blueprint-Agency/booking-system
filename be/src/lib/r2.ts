import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { currentEnv } from '../env'
import { outbound, VENDOR_DEADLINE_MS } from './outbound'

/**
 * Every network call on this client goes through `outbound`. A signed URL is
 * computed here, with no call to R2, so it does not.
 */
export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  // Short connect and socket timeouts, so a stalled bucket fails inside the
  // wrapper's deadline rather than past it. The wrapper retries when asked; the
  // SDK does not.
  requestHandler: {
    connectionTimeout: 3_000,
    socketTimeout: VENDOR_DEADLINE_MS.storage,
  },
  maxAttempts: 1,
  // R2 does not implement the SDK's flexible checksums. From @aws-sdk v3.729 the
  // default is `WHEN_SUPPORTED`, which signs the request and then adds
  // `x-amz-checksum-crc32` + `x-amz-sdk-checksum-algorithm` — R2 answers 403
  // SignatureDoesNotMatch. Cloudflare's documented setting for the S3 SDK.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  // Read when a request is first signed, not when this module loads, so a test
  // that brings its own keys has them used. The SDK keeps what this returns.
  credentials: async () => ({
    accessKeyId: currentEnv('R2_ACCESS_KEY_ID')!,
    secretAccessKey: currentEnv('R2_SECRET_ACCESS_KEY')!,
  }),
})

/**
 * The one bucket. Workshop covers, instructor photos and Supporting Documents
 * all live here.
 *
 * It is served by `R2_PUBLIC_URL`, so ANYTHING written here is readable by
 * anyone who holds the object key — including a Supporting Document. The key is
 * the only thing standing between a health document and the public, which is why
 * `supportingDocumentKey` uses two UUIDs and why no read path serialises it. The
 * signed URL below still expires, but it guards nothing an unsigned URL would
 * not also reach.
 *
 * Optional, like the rest of the storage settings — an unconfigured deployment
 * refuses the upload at use-site rather than failing to boot. Callers check
 * this is set before calling either helper below.
 *
 * Read when used rather than at import (`currentEnv` in `src/env.ts`), as is
 * the public host below, so a test can set its own.
 */
export function r2Bucket(): string | undefined {
  return currentEnv('R2_BUCKET_NAME')
}

/** The unsigned, public URL of an object — null when there is no key or no
 *  configured public host. Every read path that serialises an R2 key to a
 *  client goes through this. */
export function publicObjectUrl(key: string | null | undefined): string | null {
  const publicUrl = currentEnv('R2_PUBLIC_URL')
  if (!key || !publicUrl) return null
  return `${publicUrl.replace(/\/$/, '')}/${key.replace(/^\//, '')}`
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await outbound('storage', 'putObject', abortSignal =>
    r2.send(
      new PutObjectCommand({
        Bucket: r2Bucket(),
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
      { abortSignal },
    ),
  )
}

/**
 * Delete every object whose key starts with `prefix`, a page at a time, and
 * return how many went. Used to take a deleted studio's uploads with it
 * (`t/<tenant id>/`, see `lib/object-key.ts`).
 *
 * The caller is responsible for the prefix being narrow: an empty or bucket-wide
 * prefix is refused here rather than trusted.
 */
export async function deleteObjectsUnder(prefix: string): Promise<number> {
  // Invariant: callers pass a tenant's own folder — never the bucket root.
  if (!prefix || !prefix.endsWith('/') || prefix === '/') {
    throw new Error(`refusing to delete under a prefix that is not a folder: "${prefix}"`)
  }
  let deleted = 0
  let token: string | undefined
  do {
    const page = await outbound('storage', 'listObjects', abortSignal =>
      r2.send(
        new ListObjectsV2Command({ Bucket: r2Bucket(), Prefix: prefix, ContinuationToken: token }),
        { abortSignal },
      ),
    )
    const keys = (page.Contents ?? []).flatMap(o => (o.Key ? [{ Key: o.Key }] : []))
    if (keys.length > 0) {
      await outbound('storage', 'deleteObjects', abortSignal =>
        r2.send(
          new DeleteObjectsCommand({ Bucket: r2Bucket(), Delete: { Objects: keys, Quiet: true } }),
          { abortSignal },
        ),
      )
      deleted += keys.length
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return deleted
}

/** A signed GET, valid for `expiresIn` seconds. Generated per request, never
 *  stored. On a public bucket this is a courtesy, not a boundary — see above. */
export function signedObjectUrl(key: string, expiresIn: number): Promise<string> {
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: r2Bucket(), Key: key }), {
    expiresIn,
  })
}
