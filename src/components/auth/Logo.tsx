import { CodebrainMark } from "../ui/AppLogo";

export function Logo({
  size = 24,
  className
}: {
  size?: number;
  className?: string;
}) {
  return <CodebrainMark size={size} title="Codebrain" className={className} />;
}
