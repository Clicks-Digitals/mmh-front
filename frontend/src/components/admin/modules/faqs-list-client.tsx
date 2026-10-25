"use client";

import { SimpleCrudPage, crudListParams, str } from "@/components/admin/modules/simple-crud";
import { Badge } from "@/components/admin/ui/badge";
import { asList, createFaq, deleteFaq, listFaqs, updateFaq, type FAQ } from "@/lib/api/admin";

export function FaqsListClient() {
  return (
    <SimpleCrudPage<FAQ>
      title="FAQs"
      noun="FAQ"
      description="Questions and answers on the store's FAQ / help page, shown in sort order (lowest first). Write both English and Arabic."
      writePermission="content.write"
      searchPlaceholder="Search questions…"
      defaultOrdering="sort_order"
      wide
      list={async (tok, s) => asList(await listFaqs(tok, crudListParams(s, "sort_order")))}
      create={(tok, body) => createFaq(tok, body as Partial<FAQ>)}
      update={(tok, row, body) => updateFaq(tok, row.id, body as Partial<FAQ>)}
      remove={(tok, row) => deleteFaq(tok, row.id)}
      deleteDescription={(r) => `Permanently delete “${r.question_en}”.`}
      emptyDescription="Add the questions customers ask most (delivery time, refunds, regions…)."
      columns={[
        {
          key: "q",
          header: "Question",
          mobilePrimary: true,
          render: (r) => (
            <div className="max-w-xl">
              <p className="font-medium">{r.question_en}</p>
              {r.question_ar ? (
                <p className="text-xs text-[var(--clicks-muted)]" dir="rtl">
                  {r.question_ar}
                </p>
              ) : (
                <p className="text-[11px] text-amber-700">No Arabic version yet</p>
              )}
            </div>
          ),
        },
        {
          key: "status",
          header: "Status",
          render: (r) => <Badge status={r.published ? "PUBLISHED" : "DRAFT"}>{r.published ? "Shown" : "Hidden"}</Badge>,
        },
        { key: "sort", header: "Sort", sortKey: "sort_order", className: "tabular-nums", render: (r) => r.sort_order ?? 0 },
      ]}
      emptyValues={{ question_en: "", question_ar: "", answer_en: "", answer_ar: "", sort_order: "0", published: true }}
      toValues={(r) => ({
        question_en: r.question_en,
        question_ar: r.question_ar ?? "",
        answer_en: r.answer_en,
        answer_ar: r.answer_ar ?? "",
        sort_order: String(r.sort_order ?? 0),
        published: r.published,
      })}
      toPayload={(v) => ({
        question_en: str(v, "question_en"),
        question_ar: str(v, "question_ar"),
        answer_en: str(v, "answer_en"),
        answer_ar: str(v, "answer_ar"),
        sort_order: Number(str(v, "sort_order")) || 0,
        published: Boolean(v.published),
      })}
      fields={[
        { name: "question_en", label: "Question (English)", required: true, full: true, maxLength: 255 },
        {
          name: "question_ar",
          label: "Question (Arabic)",
          optional: true,
          rtl: true,
          full: true,
          maxLength: 255,
          hint: "Shown on the Arabic store. Falls back to English if empty.",
        },
        { name: "answer_en", label: "Answer (English)", type: "textarea", required: true },
        { name: "answer_ar", label: "Answer (Arabic)", type: "textarea", optional: true, rtl: true },
        { name: "sort_order", label: "Sort order", type: "number", hint: "Lower numbers show first." },
        { name: "published", label: "Show on the store", type: "checkbox", hint: "Unticked FAQs are hidden from customers." },
      ]}
    />
  );
}
