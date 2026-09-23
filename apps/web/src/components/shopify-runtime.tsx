export function ShopifyRuntime() {
  const runtimeUrl =
    process.env.NEXT_PUBLIC_SHOPIFY_POLARIS_RUNTIME_URL ??
    (process.env.NODE_ENV === "production" ? undefined : "https://cdn.shopify.com/shopifycloud/polaris.js");

  return (
    <>
      <meta name="shopify-api-key" content={process.env.NEXT_PUBLIC_SHOPIFY_API_KEY ?? "local-dev"} />
      {runtimeUrl ? <script src={runtimeUrl} /> : null}
    </>
  );
}
