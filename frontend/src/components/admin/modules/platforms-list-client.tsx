"use client";

import { SimpleCrudPage, crudListParams, optionalSlugError, str } from "@/components/admin/modules/simple-crud";
import { Badge } from "@/components/admin/ui/badge";
import { EntityImageField } from "@/components/admin/ui/entity-image-field";
import { EntityThumb } from "@/components/admin/ui/entity-thumb";
import { useAdminToast } from "@/components/admin/ui/toast";
import {
  asList,
  createPlatform,
  deletePlatform,
  deletePlatformImage,
  listPlatforms,
  updatePlatform,
  uploadPlatformImage,
  type AdminPlatform,
} from "@/lib/api/admin";

const STATUS_LABEL: Record<string, string> = { PUBLISHED: "Published", DRAFT: "Draft", ARCHIVED: "Archived" };

export function PlatformsListClient() {
  const toast = useAdminToast();
  return (
    <SimpleCrudPage<AdminPlatform>
      title="Platforms"
      noun="Platform"
      description="Brands/platforms a product belongs to (PlayStation, Steam, PUBG…). Published platforms with products appear in the brand row on the home page with their logo. Hiding a platform (draft or archived) hides all of its products from the store."
      writePermission="catalog.write"
      searchPlaceholder="Search platforms…"
      slugFrom="name_en"
      defaultOrdering="sort_order"
      list={async (tok, s) => asList(await listPlatforms(tok, crudListParams(s, "sort_order")))}
      create={(tok, body) => createPlatform(tok, body as Partial<AdminPlatform>)}
      update={(tok, row, body) => updatePlatform(tok, row.id, body as Partial<AdminPlatform>)}
      remove={(tok, row) => deletePlatform(tok, row.id)}
      deleteDescription={(r) =>
        `Permanently delete “${r.name_en}”. Platforms that still have products can't be deleted — archive it instead.`
      }
      columns={[
        {
          key: "name",
          header: "Name",
          mobilePrimary: true,
          render: (r) => (
            <div className="flex items-center gap-3">
              <EntityThumb imageUrl={r.image_url} artworkKey={r.artwork_key} slug={r.slug} />
              <div>
                <p className="font-medium">{r.name_en}</p>
                {r.name_ar ? <p className="text-xs text-[var(--clicks-muted)]" dir="rtl">{r.name_ar}</p> : null}
              </div>
            </div>
          ),
        },
        { key: "slug", header: "Web address", sortKey: "slug", render: (r) => <span className="font-mono text-xs">{r.slug}</span> },
        { key: "products", header: "Products", className: "tabular-nums", render: (r) => r.products_count ?? "—" },
        { key: "status", header: "Status", render: (r) => <Badge status={r.status}>{STATUS_LABEL[r.status] ?? r.status}</Badge> },
        { key: "sort", header: "Sort", sortKey: "sort_order", className: "tabular-nums", render: (r) => r.sort_order ?? 0 },
      ]}
      emptyValues={{ name_en: "", name_ar: "", slug: "", artwork_key: "", status: "PUBLISHED", sort_order: "0" }}
      toValues={(r) => ({
        name_en: r.name_en,
        name_ar: r.name_ar ?? "",
        slug: r.slug,
        artwork_key: r.artwork_key ?? "",
        status: r.status,
        sort_order: String(r.sort_order ?? 0),
      })}
      media={({ editing, values, token, canWrite, setEditing, reload }) => (
        <EntityImageField
          label="Platform logo"
          recommended="square, 512 × 512 px (logo centred on a plain background)"
          imageUrl={editing?.image_url}
          fallback={{ artworkKey: String(values.artwork_key ?? ""), slug: String(values.slug ?? "") }}
          canWrite={canWrite}
          disabledReason={editing ? undefined : "Save the platform first, then upload its logo."}
          onUpload={async (file) => {
            if (!token || !editing) return;
            setEditing(await uploadPlatformImage(token, editing.id, file));
            toast.push("Logo uploaded", "success");
            reload();
          }}
          onRemove={async () => {
            if (!token || !editing) return;
            setEditing(await deletePlatformImage(token, editing.id));
            toast.push("Logo removed", "success");
            reload();
          }}
        />
      )}
      validate={(v, editing) => ({
        slug: editing && !str(v, "slug") ? "Enter a web address, e.g. playstation." : optionalSlugError(v),
      })}
      toPayload={(v) => ({
        name_en: str(v, "name_en"),
        name_ar: str(v, "name_ar"),
        slug: str(v, "slug"),
        artwork_key: str(v, "artwork_key"),
        status: str(v, "status"),
        sort_order: Number(str(v, "sort_order")) || 0,
      })}
      fields={[
        { name: "name_en", label: "Name (English)", required: true },
        { name: "name_ar", label: "Name (Arabic)", optional: true, rtl: true },
        {
          name: "slug",
          label: "Web address (slug)",
          mono: true,
          hint: "Filled in from the English name; used in store filters and links. Changing it breaks old links.",
        },
        { name: "artwork_key", label: "Built-in picture", type: "artwork" },
        {
          name: "status",
          label: "Status",
          type: "select",
          hint: "Draft or archived hides every product of this platform on the store.",
          options: [
            { value: "PUBLISHED", label: "Published — visible" },
            { value: "DRAFT", label: "Draft — hidden" },
            { value: "ARCHIVED", label: "Archived — hidden" },
          ],
        },
        { name: "sort_order", label: "Sort order", type: "number", hint: "Lower numbers show first in menus and filters." },
      ]}
    />
  );
}
