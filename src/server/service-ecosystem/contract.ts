/** Metadata only. Canonical text and resource bytes remain at their authorized sources. */
export type MusicRow = {
  rowId: string; order: number; title: string; prayerId?: string;momentId?:string;
  liturgyRef?: { book: string; folio: number; unitId?: string; serviceViewId?: string };
  sharedDirections?: string;
  biblicalRef?: string; edition?: string; textIdentity?: string; catalogUnitId?: string;
  arrangement?: { songId?: string; fileId?: string; key?: string };
  resources: { resourceId: string; kind: "score" | "audio"; label: string }[];
};
export type MusicProjection = { setlistId: string; sourceRevision: string; localDate: string; ceremonyType: "morning" | "havdalah"; rows: MusicRow[]; operatorLinks: { music: string; review?: string } };
export type EnsureInput = { ceremonyId: string; localDate: string; ceremonyType: "morning" | "havdalah"; scheduleRevision?:number;idempotencyKey: string; explicitSetlistId?: string;excludedSetlistId?:string };
export type MusicResult = { version: 1; status: "linked"; setlistId: string; sourceRevision: string; projection: MusicProjection }
  | { version: 1; status: "ambiguous"; candidates: { setlistId: string }[] }
  | { version: 1; status: "review_required"; setlistId?: string; sourceRevision?: string; projection?: MusicProjection };
/**
 * What the music setlist's read-only Beit Mitzvah card shows (music contract BET-6, operation "details").
 * Names and citations only, never verse text. sentAt is the receiver's ordering fence.
 */
export type DetailsInput = { ceremonyId: string; sentAt: string; students: string[]; slot?: string; torahRef?: string; haftarahRef?: string; rehearsals?: string[] };
export interface MusicBroker {
  ensure(input: EnsureInput, signal?: AbortSignal): Promise<MusicResult>;
  projection(ceremonyId: string, signal?: AbortSignal): Promise<MusicResult>;
  details(input: DetailsInput, signal?: AbortSignal): Promise<MusicResult>;
  resource(ceremonyId: string, rowId: string, resourceId: string): Promise<{ resourceId: string; kind: "score" | "audio"; url: string; expiresAt: string }>;
}
