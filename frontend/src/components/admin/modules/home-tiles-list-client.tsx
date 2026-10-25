"use client";

import { SimpleCrudPage, crudListParams, str } from "@/components/admin/modules/simple-crud";
import { Badge } from "@/components/admin/ui/badge";
import { EntityImageField } from "@/components/admin/ui/entity-image-field";
import { EntityThumb } from "@/components/admin/ui/entity-thumb";
import { useAdminToast } from "@/components/admin/ui/toast";
import {
  asList,
  createHomeTile,
  deleteHomeTile,
  deleteHomeTileImage,
  listHomeTiles,
  updateHomeTile,
  uploadHomeTileImage,
  type HomeTile,
} from "@/lib/api/admin";

const HREF_RE = /^(\/|https:\/\/)/;

/** Admin → Content → Home tiles: the "MMH suggests" picture grid on the home page. */
export function HomeTilesListClient() {
  const toast = useAdminToast();
  return (
    <SimpleCrudPage<HomeTile>
      title="Home tiles"
      noun="Tile"
      description="Picture tiles in the “MMH suggests” grid on the home page, in sort order (lowest first). A tile is shown only while it is published and its link leads to products. Category circles use the category pictures (Catalog → Categories) and the brand row uses the platform logos (Catalog → Platforms)."
      writePermission="content.write"
      searchPlaceholder="Search tiles…"
      defaultOrdering="sort_order"
      list={async (tok, s) => asList(await listHomeTiles(tok, { ...crudListParams(s, "sort_order"), section: "SUGGESTED" }))}
      create={(tok, body) => createHomeTile(tok, body as Partial<HomeTile>)}
      update={(tok, row, body) => updateHomeTile(tok, row.id, body as Partial<HomeTile>)}
      remove={(tok, row) => deleteHomeTile(tok, row.id)}
      deleteDescription={(r) => `Permanently delete the “${r.title_en}” tile. Its picture is no longer shown.`}
      emptyDescription="Add tiles that link to your most popular products or categories."
      columns={[
        {
          key: "title",
          header: "Tile",
          mobilePrimary: true,
          render: (r) => (
            <div className="flex items-center gap-3">
              <EntityThumb imageUrl={r.image_url} artworkKey={r.artwork_key} />
              <div>
                <p className="font-medium">{r.title_en}</p>
                {r.title_ar ? (
                  <p className="text-xs text-[var(--clicks-muted)]" dir="rtl">
                    {r.title_ar}
                  </p>
                ) : (
                  <p className="text-[11px] text-amber-700">No Arabic title yet</p>
                )}
              </div>
            </div>
          ),
        },
        { key: "href", header: "Link", render: (r) => <span className="font-mono text-xs">{r.href}</span> },
        {
          key: "published",
          header: "Status",
          render: (r) => (r.published ? <Badge tone="success">Published</Badge> : <Badge tone="neutral">Hidden</Badge>),
        },
        { key: "sort", header: "Sort", sortKey: "sort_order", className: "tabular-nums", render: (r) => r.sort_order ?? 0 },
      ]}
      emptyValues={{ title_en: "", title_ar: "", href: "/", artwork_key: "", sort_order: "0", published: true }}
      toValues={(r) => ({
        title_en: r.title_en,
        title_ar: r.title_ar ?? "",
        href: r.href,
        artwork_key: r.artwork_key ?? "",
        sort_order: String(r.sort_order ?? 0),
        published: Boolean(r.published),
      })}
      validate={(v) => ({
        href: HREF_RE.test(str(v, "href")) ? undefined : "Start with / (e.g. /product/steam-wallet) or https://",
      })}
      toPayload={(v) => ({
        section: "SUGGESTED",
        title_en: str(v, "title_en"),
        title_ar: str(v, "title_ar"),
        href: str(v, "href"),
        artwork_key: str(v, "artwork_key"),
        sort_order: Number(str(v, "sort_order")) || 0,
        published: Boolean(v.published),
      })}
      media={({ editing, values, token, canWrite, setEditing, reload }) => (
        <EntityImageField
          label="Tile picture"
          recommended="portrait 4:5, 800 × 1000 px"
          minEdge={400}
          shape="tall"
          imageUrl={editing?.image_url}
          fallback={{ artworkKey: String(values.artwork_key ?? "") }}
          canWrite={canWrite}
          disabledReason={editing ? undefined : "Save the tile first, then upload its picture."}
          onUpload={async (file) => {
            if (!token || !editing) return;
            setEditing(await uploadHomeTileImage(token, editing.id, file));
            toast.push("Picture uploaded", "success");
            reload();
          }}
          onRemove={async () => {
            if (!token || !editing) return;
            setEditing(await deleteHomeTileImage(token, editing.id));
            toast.push("Picture removed", "success");
            reload();
          }}
        />
      )}
      fields={[
        { name: "title_en", label: "Title (English)", required: true, maxLength: 120 },
        { name: "title_ar", label: "Title (Arabic)", optional: true, rtl: true, maxLength: 120 },
        {
          name: "href",
          label: "Link",
          required: true,
          mono: true,
          hint: "Where the tile goes, e.g. /product/steam-wallet or /category/playstation.",
        },
        { name: "sort_order", label: "Sort order", type: "number", hint: "Lower numbers show first." },
        { name: "artwork_key", label: "Built-in picture", type: "artwork" },
        { name: "published", label: "Published", type: "checkbox", hint: "Untick to hide the tile without deleting it." },
      ]}
    />
  );
}
