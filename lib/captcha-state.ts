export type CaptchaPayload = {
  token: string;
  image: string;
};

export function refreshedCaptchaState(payload: CaptchaPayload, notice = "") {
  return {
    token: payload.token,
    image: payload.image,
    answer: "",
    loading: false,
    error: notice
  };
}
