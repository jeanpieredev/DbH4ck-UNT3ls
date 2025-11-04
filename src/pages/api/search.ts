import type { APIRoute } from "astro";
import { AwsClient } from "aws4fetch";
import { db } from "../../utils/db";

const R2_ACCOUNT_ID = import.meta.env.PUBLIC_R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = import.meta.env.PUBLIC_R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = import.meta.env.PUBLIC_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = import.meta.env.PUBLIC_R2_BUCKET;

// Cliente compatible con Cloudflare Workers
const r2 = new AwsClient({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service: "s3",
  region: "auto",
});

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  if (!q) {
    return new Response(
      JSON.stringify({ error: "Query parameter 'q' is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const qLower = q.toLowerCase();
  const isDni = /^\d{8}$/.test(qLower);

  try {
    // Buscar coincidencias en la base local
    const dbResults = isDni
      ? []
      : db.filter((record) => {
          const codigo = String(record["Codigo"] || "").toLowerCase();
          return codigo.includes(qLower);
        });

    // Detectar año automáticamente
    let yearFolder: number | null = null;
    if (/^20(0[7-9]|1[0-6])/.test(qLower)) {
      yearFolder = parseInt(qLower.slice(0, 4), 10);
    } else if (/^(1[7-9]|2[0-5])/.test(qLower)) {
      const prefix2 = qLower.slice(0, 2);
      yearFolder = parseInt(`20${prefix2}`, 10);
    }

    const foldersToSearch = yearFolder
      ? [yearFolder]
      : Array.from({ length: 19 }, (_, i) => 2007 + i);

    let images: { name: string; url: string }[] = [];
    const intranetResults: any[] = [];

    // 🔍 Buscar datos en intranet (si es DNI o desde DB)
    if (isDni) {
      const intranetUrl = `https://intranet.untels.edu.pe/tramitevirtual/administrado/consultarcliente?nrodocumento=${q}`;
      const intranetResponse = await fetch(intranetUrl);
      if (intranetResponse.ok) {
        const intranetData = await intranetResponse.json();
        if (intranetData && intranetData.ClienteId) {
          intranetResults.push({ documento: q, data: intranetData });
        }
      }
    } else if (dbResults.length > 0) {
      for (const record of dbResults) {
        const nroDocumento = record["Nro Documento"];
        if (!nroDocumento) continue;

        try {
          const intranetUrl = `https://intranet.untels.edu.pe/tramitevirtual/administrado/consultarcliente?nrodocumento=${nroDocumento}`;
          const intranetResponse = await fetch(intranetUrl);
          if (intranetResponse.ok) {
            const intranetData = await intranetResponse.json();
            if (intranetData && intranetData.ClienteId) {
              intranetResults.push({
                documento: String(nroDocumento),
                data: intranetData,
              });
            }
          }
        } catch (err) {
          console.error(`[Intranet] Error con ${nroDocumento}:`, err);
        }
      }
    }

    // 🖼️ Buscar imágenes en R2 (con URL firmada)
    for (const year of isDni ? [] : foldersToSearch) {
      const prefix = `dbhack-untels/${year}/`;
      const bucketUrl = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}`;

      const res = await r2.fetch(`${bucketUrl}?list-type=2&prefix=${prefix}`);

      if (!res.ok) continue;
      const xmlText = await res.text();

      // Extraer nombres de archivos con una expresión regular (sin DOMParser)
      const keys = Array.from(xmlText.matchAll(/<Key>(.*?)<\/Key>/g)).map(
        (m) => m[1]
      );

      const match = keys.find((k) => k.toLowerCase().includes(qLower));
      if (match) {
        // 🔒 Generar URL firmada válida por 1 hora
        const signed = await r2.sign(`${bucketUrl}/${match}`, {
          method: "GET",
          aws: { signQuery: true, expires: 3600 }, // 1 hora
        });

        images.push({ name: match, url: signed.url });
        break; // detener búsqueda después del primer match
      }
    }

    return new Response(
      JSON.stringify({
        images,
        dbResults: dbResults.length > 0 ? dbResults : null,
        intranetResults: intranetResults.length > 0 ? intranetResults : null,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[R2Search] Error:", err);
    return new Response(
      JSON.stringify({
        error: "Error searching images",
        details: String(err),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
