/** No browser suggestions (saved emails, passwords, names, addresses) in the app's fields: Safari ignores
 * autocomplete="off" on a field it takes for a user name or an email, but never fills one named «search». The sign-in
 * and sign-up screen (.auth) keeps them, so the password manager can fill the email and password there. */
import { useEffect } from "react";

const SKIP = ["password", "file", "checkbox", "radio", "range", "color", "hidden", "submit", "button"];

export function useNoAutofill() {
  useEffect(() => {
    let n = 0;
    const mark = () => {
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea").forEach((el) => {
        if (el.dataset.noFill || SKIP.includes(el.type) || el.closest(".auth")) return;
        el.dataset.noFill = "1";
        el.setAttribute("autocomplete", "off");
        el.setAttribute("autocorrect", "off");
        el.setAttribute("data-1p-ignore", "");
        el.setAttribute("data-lpignore", "true");
        el.setAttribute("name", `search_${++n}`);
      });
    };
    mark();
    const watch = new MutationObserver(mark);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, []);
}
