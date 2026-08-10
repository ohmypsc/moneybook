import type {
  BootstrapData,
  User
} from "../../types/api";

import styles from
  "./HomePage.module.css";


interface HomePageProps {

  user: User;

  bootstrap:
    BootstrapData;

  onLogout:
    () => Promise<void>;
}


function HomePage({
  user,
  bootstrap,
  onLogout
}: HomePageProps) {

  return (
    <main
      className={
        styles.page
      }
    >
      <header
        className={
          styles.header
        }
      >
        <div>
          <p
            className={
              styles.eyebrow
            }
          >
            우리 가계부
          </p>

          <h1>
            {
              user.name
            }님,
            안녕하세요.
          </h1>
        </div>


        <button
          type="button"

          className={
            styles.logout
          }

          onClick={
            () => {
              void onLogout();
            }
          }
        >
          로그아웃
        </button>
      </header>


      <section
        className={
          styles.card
        }
      >
        <p
          className={
            styles.cardLabel
          }
        >
          오늘도 기록해볼까요?
        </p>

        <h2>
          가계부 준비 완료
        </h2>

        <p
          className={
            styles.description
          }
        >
          로그인과 가계부 데이터가
          정상적으로 연결되었습니다.
        </p>


        <div
          className={
            styles.types
          }
        >
          {
            bootstrap
              .transactionTypes
              .map(
                type => (
                  <span
                    key={
                      type
                    }
                  >
                    {
                      type
                    }
                  </span>
                )
              )
          }
        </div>
      </section>
    </main>
  );
}


export default
  HomePage;
