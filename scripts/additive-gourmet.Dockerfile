# Layer only additive CI endpoints onto the unchanged reviewed helper image.
FROM mana-additive-base:local
USER root
COPY --chmod=0444 scripts/additive-gourmet-browser.py /app/additive_gourmet_browser.py
RUN sed -i '/^if __name__ == "__main__":/i\import additive_gourmet_browser\nadditive_gourmet_browser.register(app)\n' /app/flaresolverr.py
USER flaresolverr
