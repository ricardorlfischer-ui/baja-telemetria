@echo off
rem Servidor da telemetria no modo local, chamado pelo abrir-telemetria.ps1 (que define
rem as variaveis): a saida e os erros do node vao para o servidor.log da pasta de dados.
rem Arquivo a parte porque o conhost --headless estraga as aspas de um "cmd /c" comprido.
rem O abrir chama "cmd /d /c servidor.cmd" com esta pasta como pasta atual (o caminho nao
rem passa pela linha de comando: com ( ) & no caminho, ex. "Nova pasta (2)", o cmd tiraria
rem as aspas); os caminhos chegam pelas variaveis, que entre aspas aceitam qualquer caractere.
cd /d "%BAJA_PASTA_SERVIDOR%"
"%BAJA_NODE%" "%BAJA_SERVIDOR_JS%" >> "%BAJA_LOG%" 2>&1
