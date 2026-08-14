import styles from "./BottomNav.module.css";

export type NavigationKey =
  | "home"
  | "transactions"
  | "assets"
  | "investments"
  | "settings";

type BottomNavProps = {
  activeNavigation: NavigationKey;
  onNavigate: (navigation: NavigationKey) => void;
};

type NavigationItem = {
  key: NavigationKey;
  label: string;
};

const NAVIGATION_ITEMS: NavigationItem[] = [
  {
    key: "home",
    label: "홈",
  },
  {
    key: "transactions",
    label: "내역",
  },
  {
    key: "assets",
    label: "자산",
  },
  {
    key: "investments",
    label: "투자",
  },
  {
    key: "settings",
    label: "설정",
  },
];

export function BottomNav({
  activeNavigation,
  onNavigate,
}: BottomNavProps) {
  return (
    <nav
      className={styles.nav}
      aria-label="주요 메뉴"
    >
      <div className={styles.inner}>
        {NAVIGATION_ITEMS.map((item) => {
          const isActive =
            item.key === activeNavigation;

          return (
            <button
              key={item.key}
              type="button"
              className={[
                styles.item,
                isActive ? styles.active : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={
                isActive ? "page" : undefined
              }
              onClick={() =>
                onNavigate(item.key)
              }
            >
              <NavIcon name={item.key} />

              <span className={styles.label}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

type NavIconProps = {
  name: NavigationKey;
};

function NavIcon({
  name,
}: NavIconProps) {
  const commonProps = {
    className: styles.icon,
    viewBox: "0 0 24 24",
    fill: "none",
    strokeWidth: 1.9,
    strokeLinecap:
      "round" as const,
    strokeLinejoin:
      "round" as const,
    "aria-hidden": true,
  };

  if (name === "home") {
    return (
      <svg {...commonProps}>
        <path d="M3.5 10.5 12 3.5l8.5 7v9a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z" />
      </svg>
    );
  }

  if (name === "transactions") {
    return (
      <svg {...commonProps}>
        <path d="M8 6h12" />
        <path d="M8 12h12" />
        <path d="M8 18h12" />

        <circle
          cx="4"
          cy="6"
          r="1"
        />
        <circle
          cx="4"
          cy="12"
          r="1"
        />
        <circle
          cx="4"
          cy="18"
          r="1"
        />
      </svg>
    );
  }

  if (name === "assets") {
    return (
      <svg {...commonProps}>
        <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18a2 2 0 0 1 2 2v13H6a2 2 0 0 1-2-2z" />
        <path d="M4 8h14" />
        <path d="M15 12h5v4h-5a2 2 0 0 1 0-4Z" />
      </svg>
    );
  }

  if (name === "investments") {
    return (
      <svg {...commonProps}>
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="m7 15 4-4 3 2 5-6" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <circle
        cx="16"
        cy="7"
        r="2"
      />

      <path d="M4 17h2" />
      <path d="M10 17h10" />
      <circle
        cx="8"
        cy="17"
        r="2"
      />
    </svg>
  );
}
