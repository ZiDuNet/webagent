export function isolateHtmlPreview(html: string): string {
  const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob: https:; style-src \'unsafe-inline\' https:; font-src data: https:; script-src \'unsafe-inline\' https:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">';
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${policy}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${policy}</head>`);
  }
  return `<!doctype html><html><head>${policy}<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${html}</body></html>`;
}
