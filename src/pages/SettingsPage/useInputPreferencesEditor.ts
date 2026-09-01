import {
  useEffect,
  useState
} from "react";

import {
  apiRequest
} from "../../api/client";

import {
  getInputPreferences,
  normalizeInputPreferences,
  saveInputPreferences
} from "../../utils/inputPreferences";

import type {
  InputPreferences,
  PreferenceTransactionType,
  SharedInputPreferencesState
} from "../../utils/inputPreferences";

export interface InputAccountSource {
  accountId: string;

  accountName?: string;

  displayName: string;

  accountType: string;

  subType: string;

  owner?: string;

  paymentAccountId?:
    string |
    null;
}

export interface InputCategorySource {
  categoryId: string;

  type:
    PreferenceTransactionType;

  name: string;
}

interface BootstrapData {
  transactionTypes:
    PreferenceTransactionType[];

  members:
    string[];

  spendingTargets:
    string[];

  accounts:
    InputAccountSource[];

  categories:
    InputCategorySource[];

  inputPreferences?:
    SharedInputPreferencesState;
}

interface BootstrapResponse {
  success:
    boolean;

  apiVersion?:
    string;

  data?:
    BootstrapData;

  error?: {
    code?:
      string;

    message?:
      string;
  };
}

interface SavePreferencesResponse {
  success:
    boolean;

  apiVersion?:
    string;

  data?:
    SharedInputPreferencesState;

  error?: {
    code?:
      string;

    message?:
      string;
  };
}

interface SaveOptions {
  categories?:
    InputCategorySource[];

  accounts?:
    InputAccountSource[];

  successMessage?:
    string;
}

function getErrorMessage(
  error:
    unknown,

  fallback:
    string
) {
  return error instanceof Error
    ? error.message
    : fallback;
}

export function useInputPreferencesEditor() {
  const [
    bootstrap,
    setBootstrap
  ] =
    useState<
      BootstrapData |
      null
    >(
      null
    );

  const [
    preferences,
    setPreferences
  ] =
    useState<
      InputPreferences |
      null
    >(
      null
    );

  const [
    loading,
    setLoading
  ] =
    useState(
      true
    );

  const [
    error,
    setError
  ] =
    useState("");

  const [
    saving,
    setSaving
  ] =
    useState(
      false
    );

  const [
    feedback,
    setFeedback
  ] =
    useState("");

  const [
    saveError,
    setSaveError
  ] =
    useState("");

  useEffect(
    () => {
      let active =
        true;

      async function load() {
        setLoading(
          true
        );

        setError(
          ""
        );

        try {
          const response =
            await apiRequest<
              BootstrapResponse
            >(
              "/api/bootstrap"
            );

          if (
            !response.success ||
            !response.data
          ) {
            throw new Error(
              response.error
                ?.message ||
                "입력 화면 설정을 불러오지 못했습니다."
            );
          }

          if (
            !active
          ) {
            return;
          }

          const data =
            response.data;

          const sharedPreferences =
            data.inputPreferences
              ?.configured ===
              true &&
            data.inputPreferences
              .preferences
              ? data.inputPreferences
                  .preferences
              : null;

          const nextPreferences =
            sharedPreferences
              ? normalizeInputPreferences(
                  sharedPreferences,
                  data.categories,
                  data.accounts
                )
              : getInputPreferences(
                  data.categories,
                  data.accounts
                );

          if (
            sharedPreferences
          ) {
            saveInputPreferences(
              nextPreferences
            );
          }

          setBootstrap(
            data
          );

          setPreferences(
            nextPreferences
          );
        } catch (
          loadError
        ) {
          if (
            active
          ) {
            setError(
              getErrorMessage(
                loadError,
                "입력 화면 설정을 불러오지 못했습니다."
              )
            );
          }
        } finally {
          if (
            active
          ) {
            setLoading(
              false
            );
          }
        }
      }

      void load();

      return () => {
        active =
          false;
      };
    },
    []
  );

  function clearMessages() {
    setFeedback(
      ""
    );

    setSaveError(
      ""
    );
  }

  async function save(
    options:
      SaveOptions = {}
  ) {
    if (
      !preferences ||
      !bootstrap ||
      saving
    ) {
      return false;
    }

    const categories =
      options.categories ||
      bootstrap.categories;

    const accounts =
      options.accounts ||
      bootstrap.accounts;

    const normalized =
      normalizeInputPreferences(
        preferences,
        categories,
        accounts
      );

    saveInputPreferences(
      normalized
    );

    setPreferences(
      normalized
    );

    setSaving(
      true
    );

    clearMessages();

    try {
      const response =
        await apiRequest<
          SavePreferencesResponse
        >(
          "/api/settings/input-preferences",
          {
            method:
              "POST",

            body:
              JSON.stringify({
                preferences:
                  normalized
              })
          }
        );

      if (
        !response.success ||
        !response.data ||
        response.data
          .configured !==
          true ||
        !response.data
          .preferences
      ) {
        throw new Error(
          response.error
            ?.message ||
            "부부 공통 설정을 저장하지 못했습니다."
        );
      }

      const saved =
        normalizeInputPreferences(
          response.data
            .preferences,
          categories,
          accounts
        );

      saveInputPreferences(
        saved
      );

      setPreferences(
        saved
      );

      setFeedback(
        options.successMessage ||
          "입력 화면 설정을 저장했습니다."
      );

      return true;
    } catch (
      saveFailure
    ) {
      setSaveError(
        `공통 서버 저장에 실패했습니다. 현재 브라우저에는 저장했습니다. (${getErrorMessage(
          saveFailure,
          "알 수 없는 오류"
        )})`
      );

      return false;
    } finally {
      setSaving(
        false
      );
    }
  }

  return {
    bootstrap,
    preferences,
    setPreferences,
    loading,
    error,
    saving,
    feedback,
    saveError,
    setFeedback,
    setSaveError,
    clearMessages,
    save
  };
}
