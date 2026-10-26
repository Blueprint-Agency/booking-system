import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  PICTURE_TOO_LARGE,
  PROFILE_PICTURE_MAX_BYTES,
  removeProfilePicture,
  setProfilePicture,
  type PictureOwner,
} from '../services/profile-pictures/pictures'
import { ERROR_CODES } from '../shared/error-codes'
import { MULTIPART_ENVELOPE_BYTES, uploadedFile } from './uploaded-file'

/**
 * `POST /photo` (multipart, field `file`) and `DELETE /photo`: the caller's own
 * Profile picture, for a member under `/me` and for any staff member under
 * `/portal/profile`. Both answer `{ photo_url }`.
 *
 * `ownerOf` names the caller's own row from the auth context, never from the
 * request, and throws when the caller is acting as somebody else: a picture is
 * only ever its owner's choice.
 */
export function profilePictureRoutes(ownerOf: (c: Context) => PictureOwner) {
  return new Hono()
    .post(
      '/photo',
      bodyLimit({
        maxSize: PROFILE_PICTURE_MAX_BYTES + MULTIPART_ENVELOPE_BYTES,
        onError: c => c.json({ error: ERROR_CODES.image_too_large, message: PICTURE_TOO_LARGE }, 413),
      }),
      async c => {
        const owner = ownerOf(c)
        const file = await uploadedFile(c, { code: 'image_required', message: 'Attach a JPG, PNG or WebP image.' })
        const photoUrl = await setProfilePicture(owner, {
          contentType: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })
        return c.json({ photo_url: photoUrl })
      },
    )
    .delete('/photo', async c => {
      await removeProfilePicture(ownerOf(c))
      return c.json({ photo_url: null })
    })
}
