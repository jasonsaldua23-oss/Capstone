-- Feedback is collected for analytics only; it has no staff response workflow.
ALTER TABLE "Feedback"
    DROP COLUMN IF EXISTS "status",
    DROP COLUMN IF EXISTS "response",
    DROP COLUMN IF EXISTS "respondedAt",
    DROP COLUMN IF EXISTS "respondedBy";

DROP TYPE IF EXISTS "FeedbackStatus";
