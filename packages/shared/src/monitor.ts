import { z } from "zod";
import { ProviderKindSchema } from "./provider-kind";

export const LoadedModelInfoSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  vramBytes: z.number().nonnegative().optional(),
  ramBytes: z.number().nonnegative().optional(),
  sizeBytes: z.number().nonnegative().optional(),
  contextLength: z.number().int().nonnegative().optional(),
  raw: z.record(z.unknown()).optional(),
});
export type LoadedModelInfo = z.infer<typeof LoadedModelInfoSchema>;

export const SystemSnapshotSchema = z.object({
  ts: z.string(),
  totalMemBytes: z.number().int().nonnegative(),
  freeMemBytes: z.number().int().nonnegative(),
  loadavg: z.tuple([z.number(), z.number(), z.number()]),
  cpuCount: z.number().int().positive(),
  platform: z.string(),
});
export type SystemSnapshot = z.infer<typeof SystemSnapshotSchema>;

export const GpuDeviceSnapshotSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string(),
  memoryTotalMiB: z.number(),
  memoryUsedMiB: z.number(),
  utilizationPct: z.number(),
});
export type GpuDeviceSnapshot = z.infer<typeof GpuDeviceSnapshotSchema>;

export const GpuSnapshotSchema = z.object({
  available: z.boolean(),
  devices: z.array(GpuDeviceSnapshotSchema),
  error: z.string().optional(),
});
export type GpuSnapshot = z.infer<typeof GpuSnapshotSchema>;

export const ProviderMonitorSourceSchema = z.enum(["http", "cli", "none"]);
export type ProviderMonitorSource = z.infer<typeof ProviderMonitorSourceSchema>;

export const MonitorSnapshotResponseSchema = z.object({
  ts: z.string(),
  localhost: z.boolean(),
  remoteLoopback: z.boolean(),
  reason: z.string().optional(),
  system: SystemSnapshotSchema.nullable(),
  gpu: GpuSnapshotSchema.nullable(),
  provider: z.object({
    kind: ProviderKindSchema,
    baseUrl: z.string(),
    source: ProviderMonitorSourceSchema,
    loaded: z.array(LoadedModelInfoSchema),
    http: z
      .object({
        ok: z.boolean(),
        status: z.number().optional(),
        error: z.string().optional(),
      })
      .optional(),
    cli: z
      .object({
        ok: z.boolean(),
        error: z.string().optional(),
      })
      .optional(),
  }),
});
export type MonitorSnapshotResponse = z.infer<typeof MonitorSnapshotResponseSchema>;

export const LmsAvailabilitySchema = z.object({
  enabled: z.boolean(),
  remoteLoopback: z.boolean(),
  binary: z
    .object({
      ok: z.boolean(),
      version: z.string().optional(),
      error: z.string().optional(),
    })
    .nullable(),
});
export type LmsAvailability = z.infer<typeof LmsAvailabilitySchema>;
