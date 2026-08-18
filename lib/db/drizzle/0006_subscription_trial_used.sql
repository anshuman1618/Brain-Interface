-- The two-month trial pack is bought ONCE.
--
-- Nothing else stops a chamber re-selecting the Rs 99 trial the moment it
-- expires, forever, which would make every paid plan optional. Stamping when
-- the trial was taken is what lets the selection endpoint refuse a second one.
--
-- Additive, nullable and guarded, like every migration in this directory:
-- a NULL means "no trial taken", which is the correct reading for every row
-- that already exists, so there is no backfill.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "trial_used_at" timestamptz;
