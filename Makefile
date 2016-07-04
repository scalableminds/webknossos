
COFFEE_FILES:=$(shell find app/assets/javascripts/ -name "*.coffee")
ES6_FILES:=$(subst javascripts,javascripts_es6,$(COFFEE_FILES:%.coffee=%.js))

app/assets/javascripts_es6/%.js: app/assets/javascripts/%.coffee
	mkdir -p $(@D)
	decaffeinate < $< > $@

es6: $(ES6_FILES)

.PHONY: es6
