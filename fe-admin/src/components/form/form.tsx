"use client";

import {
  FormProvider,
  useForm,
  type DefaultValues,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ZodType } from "zod";
import type { ReactNode } from "react";

export interface FormProps<T extends FieldValues> {
  schema: ZodType<T>;
  defaultValues: DefaultValues<T>;
  onSubmit: (data: T, form: UseFormReturn<T>) => Promise<void> | void;
  children: (form: UseFormReturn<T>) => ReactNode;
  id?: string;
  className?: string;
}

export function Form<T extends FieldValues>({
  schema,
  defaultValues,
  onSubmit,
  children,
  id,
  className,
}: FormProps<T>) {
  const form = useForm<T>({
    resolver: zodResolver(schema) as never,
    defaultValues,
  });
  return (
    <FormProvider {...form}>
      <form
        id={id}
        className={className ?? "space-y-4"}
        onSubmit={form.handleSubmit((data) => onSubmit(data, form))}
      >
        {children(form)}
      </form>
    </FormProvider>
  );
}
