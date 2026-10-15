FROM ghcr.io/flaresolverr/flaresolverr:v3.4.6

USER root
# FlareSolverr disables TLS verification by default. Use Chromium's trust store.
RUN sed -i '/options.add_argument.*--ignore-certificate-errors/d; /options.add_argument.*--ignore-ssl-errors/d' /app/utils.py
RUN sed -i '/options = uc.ChromeOptions()/a\    options.set_capability("acceptInsecureCerts", False)' /app/utils.py
RUN ! grep -Eq -- '--ignore-certificate-errors|--ignore-ssl-errors' /app/utils.py \
    && grep -Fq 'options.set_capability("acceptInsecureCerts", False)' /app/utils.py
COPY --chmod=0444 browser_request.py /app/browser_request.py
RUN sed -i '/^if __name__ == "__main__":/i\import browser_request\nbrowser_request.register(app)\n' /app/flaresolverr.py
COPY --chmod=0555 start.sh /app/start-tests.sh
USER flaresolverr
ENTRYPOINT ["sh", "/app/start-tests.sh"]
