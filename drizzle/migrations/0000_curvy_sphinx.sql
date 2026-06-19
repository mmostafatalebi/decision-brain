CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contradictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fact_a_id" uuid NOT NULL,
	"fact_b_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolution" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"facts_used" uuid[] NOT NULL,
	"signals_used" uuid[] NOT NULL,
	"research_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommendation" text NOT NULL,
	"confidence" real NOT NULL,
	"open_gaps" text[] DEFAULT '{}' NOT NULL,
	"human_decision" text,
	"human_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"canonical_name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_item_id" text NOT NULL,
	"subject_id" uuid,
	"predicate" text NOT NULL,
	"value" jsonb NOT NULL,
	"evidence_tier" smallint NOT NULL,
	"confidence" real NOT NULL,
	"verbatim_quote" text NOT NULL,
	"quote_offset" jsonb,
	"valid_at" timestamp with time zone NOT NULL,
	"learned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_by" uuid,
	"embedding" vector(1536),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raw_items" (
	"id" text PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text NOT NULL,
	"body" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"predicate" text NOT NULL,
	"target_id" uuid NOT NULL,
	"evidence_facts" uuid[] DEFAULT '{}' NOT NULL,
	"confidence" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"centroid" vector(1536) NOT NULL,
	"fact_ids" uuid[] NOT NULL,
	"status" text NOT NULL,
	"evidence_count" integer NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"promoted_at" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contradictions" ADD CONSTRAINT "contradictions_fact_a_id_facts_id_fk" FOREIGN KEY ("fact_a_id") REFERENCES "public"."facts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contradictions" ADD CONSTRAINT "contradictions_fact_b_id_facts_id_fk" FOREIGN KEY ("fact_b_id") REFERENCES "public"."facts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "facts" ADD CONSTRAINT "facts_raw_item_id_raw_items_id_fk" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "facts" ADD CONSTRAINT "facts_subject_id_entities_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "facts" ADD CONSTRAINT "facts_superseded_by_facts_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."facts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "relations" ADD CONSTRAINT "relations_source_id_entities_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "relations" ADD CONSTRAINT "relations_target_id_entities_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contradictions_pair_idx" ON "contradictions" USING btree ("fact_a_id","fact_b_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_embedding_idx" ON "entities" USING ivfflat ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "facts_embedding_idx" ON "facts" USING ivfflat ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "facts_predicate_subject_idx" ON "facts" USING btree ("predicate","subject_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "facts_valid_at_idx" ON "facts" USING btree ("valid_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_centroid_idx" ON "signals" USING ivfflat ("centroid" vector_cosine_ops);