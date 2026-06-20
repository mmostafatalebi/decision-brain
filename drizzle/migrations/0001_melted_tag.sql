DROP INDEX IF EXISTS "contradictions_pair_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contradictions_pair_idx" ON "contradictions" USING btree ("fact_a_id","fact_b_id");