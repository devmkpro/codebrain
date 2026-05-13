import logoUrl from "../../assets/logo.png";

export function Logo({
  size = 24,
  className
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt="CodeBrain"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}