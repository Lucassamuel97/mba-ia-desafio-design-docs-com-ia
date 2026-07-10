# Makefile — atalhos para gerenciar o subtree do claude-plugins

PLUGIN_PREFIX := .claude/plugins/claude-plugins
PLUGIN_REMOTE := claude-plugins
PLUGIN_BRANCH := main

.PHONY: pull-plugin push-plugin help

## pull-plugin: puxa as atualizacoes do repo claude-plugins para este projeto
pull-plugin:
	git subtree pull --prefix=$(PLUGIN_PREFIX) $(PLUGIN_REMOTE) $(PLUGIN_BRANCH) --squash

## push-plugin: envia alteracoes feitas aqui de volta para o repo claude-plugins
push-plugin:
	git subtree push --prefix=$(PLUGIN_PREFIX) $(PLUGIN_REMOTE) $(PLUGIN_BRANCH)

## help: lista os comandos disponiveis
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## //'
