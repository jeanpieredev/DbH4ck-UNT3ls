import fs from "fs";
import path from "path";
import mime from "mime-types";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const R2 = new S3Client({
  region: "auto",
  endpoint: "https://537d033e8049c766d794854f0af41c74.r2.cloudflarestorage.com",
  credentials: {
    accessKeyId: "a25fee87c19f7050d048e1c933c150d7",
    secretAccessKey: "8e5d320c7a80fc516c75abe9fd9c45ca50a402422b7e09bc2488d8fffefcf35a",
  },
});

const bucket = "dbhack-untels";
const carpeta = "/home/jp/working/test-untels/images/";
console.log(carpeta);

async function subirCarpeta(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      await subirCarpeta(filePath);
    } else {
      const key = path.relative(carpeta, filePath);
      const fileContent = fs.readFileSync(filePath);
      const contentType = mime.lookup(filePath) || "application/octet-stream";

      await R2.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: fileContent,
          ContentType: contentType,
        })
      );
      console.log(`✅ Subido: ${key}`);
    }
  }
}

subirCarpeta(carpeta).catch(console.error);
