"use client";

import type { ReactNode } from "react";
import type { DefaultValues, FieldValues, UseFormReturn } from "react-hook-form";
import type { ZodType } from "zod";
import { Dialog, DialogFooter, Button } from "@/components/ui";
import { Form } from "./form";

export interface FormDialogProps<T extends FieldValues> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  schema: ZodType<T>;
  defaultValues: DefaultValues<T>;
  onSubmit: (data: T, form: UseFormReturn<T>) => Promise<void> | void;
  submitLabel?: string;
  cancelLabel?: string;
  submitVariant?: "primary" | "danger";
  children: (form: UseFormReturn<T>) => ReactNode;
}

export function FormDialog<T extends FieldValues>({
  open,
  onOpenChange,
  title,
  description,
  schema,
  defaultValues,
  onSubmit,
  submitLabel = "Save",
  cancelLabel = "Cancel",
  submitVariant = "primary",
  children,
}: FormDialogProps<T>) {
  const formId = `form-${title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <Form
        id={formId}
        schema={schema}
        defaultValues={defaultValues}
        onSubmit={async (data, form) => {
          await onSubmit(data, form);
          onOpenChange(false);
        }}
      >
        {(form) => (
          <>
            {children(form)}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {cancelLabel}
              </Button>
              <Button type="submit" variant={submitVariant} disabled={form.formState.isSubmitting}>
                {submitLabel}
              </Button>
            </DialogFooter>
          </>
        )}
      </Form>
    </Dialog>
  );
}
