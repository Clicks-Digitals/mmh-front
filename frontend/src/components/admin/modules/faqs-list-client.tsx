"use client";

import { SimpleCrudPage, str } from "@/components/admin/modules/simple-crud";
import { Badge } from "@/components/admin/ui/badge";
import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { asList, createFaq, deleteFaq, listFaqs, updateFaq, type FAQ } from "@/lib/api/admin";

export function FaqsListClient() {
  return (
    <SimpleCrudPage<FAQ>
      title="FAQs"
      noun="FAQ"
      description="Questions shown on the store's FAQ / help page, in sort order."
      writePermission="content.write"
      searchPlaceholder="Search questions…"
      wide
      list={async (tok, p, s) =>
        asList(await listFaqs(tok, { page: p, page_size: ADMIN_LIST_PAGE_SIZE, search: s || undefined }))
      }
      create={(tok, body) => createFaq(tok, body as Partial<FAQ>)}
      update={(tok, row, body) => updateFaq(tok, row.id, body as Partial<FAQ>)}
      remove={(tok, row) => deleteFaq(tok, row.id)}
      deleteDescription={(r) => `Permanently delete “${r.question_en}”.`}
      columns={[
        {
          key: "q",
          header: "Question",
          render: (r) => (
            <div className="max-w-xl">
              <p className="font-medium">{r.question_en}</p>
              {r.question_ar ? <p className="text-xs text-[var(--clicks-muted)]" dir="rtl">{r.question_ar}</p> : null}
            </div>
          ),
        },
        {
          key: "status",
          header: "Status",
          render: (r) => <Badge status={r.published ? "PUBLISHED" : "DRAFT"} />,
        },
        { key: "sort", header: "Sort", className: "tabular-nums", render: (r) => r.sort_order ?? 0 },
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
        { name: "question_en", label: "Question (EN)", required: true, full: true, maxLength: 255 },
        { name: "question_ar", label: "Question (AR)", rtl: true, full: true, maxLength: 255, hint: "Shown on the Arabic store. Falls back to English if empty." },
        { name: "answer_en", label: "Answer (EN)", type: "textarea", required: true },
        { name: "answer_ar", label: "Answer (AR)", type: "textarea", rtl: true },
        { name: "sort_order", label: "Sort order", type: "number", hint: "Lower shows first." },
        { name: "published", label: "Published", type: "checkbox", hint: "Unpublished FAQs are hidden from the store." },
      ]}
    />
  );
}
