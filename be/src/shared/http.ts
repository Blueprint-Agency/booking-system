import type { Context } from 'hono'

/** 200 — payload as-is. */
export const ok = <T>(c: Context, data: T) => c.json(data)

/** 201 — for resource creation. */
export const created = <T>(c: Context, data: T) => c.json(data, 201)

/** 204-style "no body" — Hono can't send a true 204 with json(), so use status() */
export const noContent = (c: Context) => c.body(null, 204)
