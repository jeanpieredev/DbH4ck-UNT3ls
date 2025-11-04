declare module '@xmldom/xmldom' {
  export class DOMParser {
    parseFromString(xml: string, mimeType?: string): Document;
  }
}


