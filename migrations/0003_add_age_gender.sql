-- Add birth_date and gender to profiles
ALTER TABLE profiles ADD COLUMN birth_date TEXT DEFAULT '';
ALTER TABLE profiles ADD COLUMN gender TEXT DEFAULT '';
