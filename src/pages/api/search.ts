import type { APIRoute } from 'astro';
// Polyfill DOMParser for Node runtimes to satisfy AWS SDK XML parsing
import { DOMParser as XmldomParser } from '@xmldom/xmldom';
if (typeof (globalThis as any).DOMParser === 'undefined') {
  (globalThis as any).DOMParser = XmldomParser as unknown as DOMParser;
}
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from '../../utils/db';

const R2_ACCOUNT_ID = import.meta.env.PUBLIC_R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = import.meta.env.PUBLIC_R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = import.meta.env.PUBLIC_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = import.meta.env.PUBLIC_R2_BUCKET;

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  if (!q) {
    return new Response(JSON.stringify({ error: "Query parameter 'q' is required",envs: `${R2_ACCOUNT_ID}, ${R2_ACCESS_KEY_ID}, ${R2_SECRET_ACCESS_KEY}, ${R2_BUCKET}` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const qLower = q.toLowerCase();
  const isDni = /^\d{8}$/.test(qLower);

  try {
    // Buscar solo por Código en la base local 
    const dbResults = isDni
      ? []
      : db.filter((record) => {
          const codigo = String(record["Codigo"] || "").toLowerCase();
          return codigo.includes(qLower);
        });

    let yearFolder: number | null = null;

    // 🧮 Detectar carpeta automáticamente
    // Caso 1: Código comienza con 2007-2016 (año completo)
    if (/^20(0[7-9]|1[0-6])/.test(qLower)) {
      yearFolder = parseInt(qLower.slice(0, 4), 10);
    } 
    // Caso 2: Código comienza con 17-25 (años abreviados 2017-2025)
    else if (/^(1[7-9]|2[0-5])/.test(qLower)) {
      const prefix2 = qLower.slice(0, 2);
      yearFolder = parseInt(`20${prefix2}`, 10);
    }

    // Si no se detectó año, buscar en todas las carpetas (2007-2025)
    const foldersToSearch = yearFolder 
      ? [yearFolder] 
      : Array.from({ length: 19 }, (_, i) => 2007 + i);

    let images: { name: string; url: string }[] = [];
    
    // Consultar datos del intranet (si es DNI directo, o si es código usando el DNI de cada registro encontrado)
    const intranetResults: any[] = [];
    if (isDni) {
      try {
        const intranetUrl = `https://intranet.untels.edu.pe/tramitevirtual/administrado/consultarcliente?nrodocumento=${q}`;
        const intranetResponse = await fetch(intranetUrl);
        if (intranetResponse.ok) {
          const intranetData = await intranetResponse.json();
          if (intranetData && intranetData.ClienteId) {
            intranetResults.push({ documento: q, data: intranetData });
          }
        }
      } catch (err) {
        console.error(`[Intranet] Error consultando documento ${q}:`, err);
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
              intranetResults.push({ documento: String(nroDocumento), data: intranetData });
            }
          }
        } catch (err) {
          console.error(`[Intranet] Error consultando documento ${nroDocumento}:`, err);
        }
      }
    }

    // Buscar imágenes solo cuando NO es DNI (códigos)
    for (const year of (isDni ? [] : foldersToSearch)) {
      const prefix = `dbhack-untels/${year}/`;
      console.log(`[R2Search] Buscando en carpeta: ${prefix}`);

      const res = await r2.send(
        new ListObjectsV2Command({
          Bucket: R2_BUCKET,
          Prefix: prefix,
        })
      );

      const match = (res.Contents ?? []).find((obj) => 
        obj.Key?.toLowerCase().includes(qLower)
      );

      if (match?.Key) {
        console.log(`✅ [R2Search] Encontrado en ${year}:`, match.Key);
        const command = new GetObjectCommand({
          Bucket: R2_BUCKET,
          Key: match.Key,
        });
        const signedUrl = await getSignedUrl(r2, command, { expiresIn: 3600 });
        images.push({ name: match.Key, url: signedUrl });
        break;
      }
    }

    return new Response(JSON.stringify({ 
      images,
      dbResults: dbResults.length > 0 ? dbResults : null,
      intranetResults: intranetResults.length > 0 ? intranetResults : null
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[R2Search] Error:", err);
    return new Response(JSON.stringify({ error: "Error searching images", details: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
