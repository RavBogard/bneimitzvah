-- CRC Torah is the product's name (Daniel, 2026-10-22). Notification email copy reads
-- tenant.product_name, so CRC's row follows the rename. Only that public label changes;
-- the congregation's name, customs and hosts stay as they are.
UPDATE tenant SET product_name = 'CRC Torah' WHERE id = 'crc';
