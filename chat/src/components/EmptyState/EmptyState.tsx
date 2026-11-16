import { Icon, type IconName } from "../ui/Icon";
import "./EmptyState.css";

export interface QuickStart {
  title: string;
  description: string;
}

const TONES: { icon: IconName; tone: string }[] = [
  { icon: "search", tone: "blue" },
  { icon: "shield", tone: "green" },
  { icon: "layers", tone: "amber" },
  { icon: "file-code", tone: "violet" },
  { icon: "edit", tone: "teal" },
  { icon: "sparkles", tone: "rose" },
];

export function EmptyState({ title, subtitle, prompts, logo, onPick }: {
  title: string;
  subtitle: string;
  prompts: QuickStart[];
  logo?: string;
  onPick: (text: string) => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__intro">
        {logo
          ? <img className="empty-state__logo" src={logo} alt="" />
          : <span className="empty-state__mark" aria-hidden="true"><Icon name="sparkles" size={26} /></span>}
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {prompts.length > 0 && (
        <div className="empty-state__quick">
          <span className="empty-state__label">快速开始</span>
          <div className="empty-state__grid">
            {prompts.map((prompt, index) => {
              const { icon, tone } = TONES[index % TONES.length];
              return (
                <button type="button" className="empty-state__card" key={`${prompt.title}-${index}`} onClick={() => onPick(prompt.title)}>
                  <span className={`empty-state__badge empty-state__badge--${tone}`} aria-hidden="true"><Icon name={icon} size={17} /></span>
                  <span className="empty-state__text">
                    <strong>{prompt.title}</strong>
                    {prompt.description && <em>{prompt.description}</em>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
