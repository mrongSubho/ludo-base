declare module "qrcode" {
    export function toDataURL(text: string, opts?: { margin?: number; width?: number }): Promise<string>;
}
