-- A member's General settings in the member app: light or dark, and the text
-- size. Kept on the member's row so they follow the member to every device they
-- sign in on. Null until chosen, so every existing row keeps the app's default.
CREATE TYPE "public"."client_font_size" AS ENUM('small', 'medium', 'large');--> statement-breakpoint
CREATE TYPE "public"."client_theme" AS ENUM('light', 'dark');--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "theme" "client_theme";--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "font_size" "client_font_size";
