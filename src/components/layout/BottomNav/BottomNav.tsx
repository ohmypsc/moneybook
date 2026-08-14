import styles
  from "./BottomNav.module.css";


/*
 * transactions / investments는
 * 기존 App.tsx와의 중간 배포 호환을 위해
 * 잠시 타입에만 남겨둠.
 *
 * 실제 하단 메뉴에는 표시하지 않음.
 * App.tsx 교체 후 추후 제거 가능.
 */
export type NavigationKey =
  | "home"
  | "calendar"
  | "input"
  | "assets"
  | "settings"
  | "transactions"
  | "investments";


type BottomNavProps = {
  activeNavigation:
    NavigationKey;

  onNavigate:
    (
      navigation:
        NavigationKey
    ) => void;
};


type NavigationItem = {
  key:
    NavigationKey;

  label:
    string;
};


const LEFT_ITEMS:
  NavigationItem[] = [
    {
      key:
        "home",

      label:
        "홈"
    },

    {
      key:
        "calendar",

      label:
        "달력"
    }
  ];


const RIGHT_ITEMS:
  NavigationItem[] = [
    {
      key:
        "assets",

      label:
        "자산"
    },

    {
      key:
        "settings",

      label:
        "설정"
    }
  ];


export function BottomNav({
  activeNavigation,
  onNavigate
}: BottomNavProps) {

  return (
    <nav
      className={
        styles.nav
      }

      aria-label={
        "주요 메뉴"
      }
    >
      <div
        className={
          styles.inner
        }
      >
        {
          LEFT_ITEMS.map(
            item => (
              <NavigationButton
                key={
                  item.key
                }

                item={
                  item
                }

                activeNavigation={
                  activeNavigation
                }

                onNavigate={
                  onNavigate
                }
              />
            )
          )
        }


        <button
          type="button"

          className={[
            styles.inputItem,

            activeNavigation ===
              "input"
              ? styles.inputActive
              : ""
          ]
            .filter(Boolean)
            .join(" ")}

          aria-current={
            activeNavigation ===
              "input"
              ? "page"
              : undefined
          }

          aria-label={
            "거래 입력"
          }

          onClick={
            () =>
              onNavigate(
                "input"
              )
          }
        >
          <span
            className={
              styles.inputIconWrap
            }
          >
            <svg
              className={
                styles.inputIcon
              }

              viewBox="0 0 24 24"

              fill="none"

              strokeWidth="2"

              strokeLinecap="round"

              strokeLinejoin="round"

              aria-hidden="true"
            >
              <path
                d="M12 5v14"
              />

              <path
                d="M5 12h14"
              />
            </svg>
          </span>

          <span
            className={
              styles.inputLabel
            }
          >
            입력
          </span>
        </button>


        {
          RIGHT_ITEMS.map(
            item => (
              <NavigationButton
                key={
                  item.key
                }

                item={
                  item
                }

                activeNavigation={
                  activeNavigation
                }

                onNavigate={
                  onNavigate
                }
              />
            )
          )
        }
      </div>
    </nav>
  );
}


type NavigationButtonProps = {
  item:
    NavigationItem;

  activeNavigation:
    NavigationKey;

  onNavigate:
    (
      navigation:
        NavigationKey
    ) => void;
};


function NavigationButton({
  item,
  activeNavigation,
  onNavigate
}: NavigationButtonProps) {

  const isActive =
    item.key ===
      activeNavigation;


  return (
    <button
      type="button"

      className={[
        styles.item,

        isActive
          ? styles.active
          : ""
      ]
        .filter(Boolean)
        .join(" ")}

      aria-current={
        isActive
          ? "page"
          : undefined
      }

      onClick={
        () =>
          onNavigate(
            item.key
          )
      }
    >
      <NavIcon
        name={
          item.key
        }
      />

      <span
        className={
          styles.label
        }
      >
        {
          item.label
        }
      </span>
    </button>
  );
}


type NavIconProps = {
  name:
    NavigationKey;
};


function NavIcon({
  name
}: NavIconProps) {

  const commonProps = {
    className:
      styles.icon,

    viewBox:
      "0 0 24 24",

    fill:
      "none",

    strokeWidth:
      1.9,

    strokeLinecap:
      "round" as const,

    strokeLinejoin:
      "round" as const,

    "aria-hidden":
      true
  };


  if (
    name ===
      "home"
  ) {
    return (
      <svg
        {...commonProps}
      >
        <path
          d="M3.5 10.5 12 3.5l8.5 7v9a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z"
        />
      </svg>
    );
  }


  if (
    name ===
      "calendar"
  ) {
    return (
      <svg
        {...commonProps}
      >
        <rect
          x="3.5"
          y="5.5"
          width="17"
          height="15"
          rx="2"
        />

        <path
          d="M8 3.5v4"
        />

        <path
          d="M16 3.5v4"
        />

        <path
          d="M3.5 10h17"
        />

        <path
          d="M8 14h.01"
        />

        <path
          d="M12 14h.01"
        />

        <path
          d="M16 14h.01"
        />

        <path
          d="M8 17h.01"
        />

        <path
          d="M12 17h.01"
        />
      </svg>
    );
  }


  if (
    name ===
      "assets"
  ) {
    return (
      <svg
        {...commonProps}
      >
        <path
          d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18a2 2 0 0 1 2 2v13H6a2 2 0 0 1-2-2z"
        />

        <path
          d="M4 8h14"
        />

        <path
          d="M15 12h5v4h-5a2 2 0 0 1 0-4Z"
        />
      </svg>
    );
  }


  return (
    <svg
      {...commonProps}
    >
      <path
        d="M4 7h10"
      />

      <path
        d="M18 7h2"
      />

      <circle
        cx="16"
        cy="7"
        r="2"
      />

      <path
        d="M4 17h2"
      />

      <path
        d="M10 17h10"
      />

      <circle
        cx="8"
        cy="17"
        r="2"
      />
    </svg>
  );
}
