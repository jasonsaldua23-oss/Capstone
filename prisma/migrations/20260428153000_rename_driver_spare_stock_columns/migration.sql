DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'DriverSpareStock' AND column_name = 'quantity'
    ) THEN
        EXECUTE 'ALTER TABLE "DriverSpareStock" RENAME COLUMN "quantity" TO "on_hand_quantity"';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'DriverSpareStock' AND column_name = 'min_quantity'
    ) THEN
        EXECUTE 'ALTER TABLE "DriverSpareStock" RENAME COLUMN "min_quantity" TO "minimum_required_quantity"';
    END IF;
END
$$;