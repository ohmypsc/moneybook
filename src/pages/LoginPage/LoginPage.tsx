import {
  useState
} from "react";

import type {
  FormEvent
} from "react";

import { Button } from "../../components/common/Button/Button";
import { Card } from "../../components/common/Card/Card";

import styles from
  "./LoginPage.module.css";


interface LoginPageProps {

  loading: boolean;

  errorMessage: string;

  onLogin: (
    name: string,
    password: string
  ) => Promise<void>;
}


function LoginPage({
  loading,
  errorMessage,
  onLogin
}: LoginPageProps) {

  const [
    name,
    setName
  ] =
    useState("");

  const [
    password,
    setPassword
  ] =
    useState("");


  async function handleSubmit(
    event:
      FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (
      !name.trim() ||
      !password
    ) {
      return;
    }

    await onLogin(
      name.trim(),
      password
    );
  }


  return (
    <main
      className={
        styles.page
      }
    >
      <Card
        as="section"
        padding="lg"
        className={styles.card}
      >
        <div
          className={
            styles.heading
          }
        >
          <h1>
            우리 가계부
          </h1>

          <p>
            함께 쓰는 우리의 기록
          </p>
        </div>


        <form
          className={
            styles.form
          }
          onSubmit={
            handleSubmit
          }
        >
          <label
            className={
              styles.field
            }
          >
            <span>
              이름
            </span>

            <input
              value={
                name
              }

              autoComplete=
                "username"

              disabled={
                loading
              }

              onChange={
                event =>
                  setName(
                    event
                      .target
                      .value
                  )
              }
            />
          </label>


          <label
            className={
              styles.field
            }
          >
            <span>
              비밀번호
            </span>

            <input
              type=
                "password"

              value={
                password
              }

              autoComplete=
                "current-password"

              disabled={
                loading
              }

              onChange={
                event =>
                  setPassword(
                    event
                      .target
                      .value
                  )
              }
            />
          </label>


          <Button
            type="submit"
            fullWidth
            size="lg"
            loading={loading}
            loadingLabel="로그인 중..."
            disabled={!name.trim() || !password}
          >
            로그인
          </Button>
        </form>


        {
          errorMessage && (
            <p
              className={
                styles.error
              }
              role="alert"
              aria-live="polite"
            >
              {
                errorMessage
              }
            </p>
          )
        }
      </Card>
    </main>
  );
}


export default
  LoginPage;
