import { z } from 'zod'
import { normaliseWebSocketUrl } from './connect.helpers'

export const connectSchema = z.object({
  url: z
    .string()
    .min(1, 'WSS URL is required')
    .transform((raw) => normaliseWebSocketUrl(raw))
    .refine((v) => v.length > 0, 'WSS URL is required'),
  token: z
    .string()
    .transform((raw) => raw.trim())
    .refine((v) => v.length > 0, 'Token is required'),
})

export type ConnectInputs = z.input<typeof connectSchema>
export type ConnectOutputs = z.output<typeof connectSchema>
