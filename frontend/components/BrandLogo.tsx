/** Official Keepers wordmark — same assets as the mobile app. */
export function BrandLogo({
  tone = "dark",
  className = "",
  height = 32,
}: {
  /** Surface the logo sits on: dark surface → light mark. */
  tone?: "light" | "dark";
  className?: string;
  height?: number;
}) {
  const src =
    tone === "dark" ? "/brand/logo-light.png" : "/brand/logo-dark.png";
  // Match mobile BrandLogo aspect (1400 / 349)
  const width = Math.round(height * (1400 / 349));

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Keepers Adventures 4x4"
      width={width}
      height={height}
      className={className}
      style={{ width, height, objectFit: "contain" }}
    />
  );
}
