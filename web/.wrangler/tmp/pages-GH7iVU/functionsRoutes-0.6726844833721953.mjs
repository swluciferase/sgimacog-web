import { onRequestGet as __functions_api_font_js_onRequestGet } from "/Users/swryociao/sgimacog-web/web/functions/functions/api/font.js"
import { onRequestPost as __functions_api_font_js_onRequestPost } from "/Users/swryociao/sgimacog-web/web/functions/functions/api/font.js"
import { onRequestGet as __api_font_js_onRequestGet } from "/Users/swryociao/sgimacog-web/web/functions/api/font.js"
import { onRequestPost as __api_font_js_onRequestPost } from "/Users/swryociao/sgimacog-web/web/functions/api/font.js"
import { onRequest as __functions__middleware_js_onRequest } from "/Users/swryociao/sgimacog-web/web/functions/functions/_middleware.js"
import { onRequest as ___middleware_js_onRequest } from "/Users/swryociao/sgimacog-web/web/functions/_middleware.js"

export const routes = [
    {
      routePath: "/functions/api/font",
      mountPath: "/functions/api",
      method: "GET",
      middlewares: [],
      modules: [__functions_api_font_js_onRequestGet],
    },
  {
      routePath: "/functions/api/font",
      mountPath: "/functions/api",
      method: "POST",
      middlewares: [],
      modules: [__functions_api_font_js_onRequestPost],
    },
  {
      routePath: "/api/font",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_font_js_onRequestGet],
    },
  {
      routePath: "/api/font",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_font_js_onRequestPost],
    },
  {
      routePath: "/functions",
      mountPath: "/functions",
      method: "",
      middlewares: [__functions__middleware_js_onRequest],
      modules: [],
    },
  {
      routePath: "/",
      mountPath: "/",
      method: "",
      middlewares: [___middleware_js_onRequest],
      modules: [],
    },
  ]