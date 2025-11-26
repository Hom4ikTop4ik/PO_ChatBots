import json
import uuid
from typing import Dict, Any, List, Optional, Callable
from enum import Enum
from pathlib import Path

class BlockType(Enum):
    START = "start"
    SEND_MESSAGE = "sendMessage"
    GET_MESSAGE = "getMessage"
    CHOICE = "choice"
    FINAL = "final"

class ValidationError(Exception):
    """Кастомное исключение для ошибок валидации"""
    def __init__(self, message: str, field: str = None, block_id: str = None, block_type: str = None):
        self.message = message
        self.field = field
        self.block_id = block_id
        self.block_type = block_type
        super().__init__(self._format_message())
    
    def _format_message(self):
        parts = []
        if self.block_type:
            parts.append(f"тип блока: {self.block_type}")
        if self.block_id:
            parts.append(f"Block_id: {self.block_id}")
        if self.field:
            parts.append(f"поле: {self.field}")
        
        context = f" ({', '.join(parts)})" if parts else ""
        return f"{self.message}{context}"

class BotConfigParser:
    """
    Модульный парсер JSON-конфигурации бота с расширяемой архитектурой
    """
    
    def __init__(self):
        # Регистр парсеров параметров для каждого типа блока
        self._param_parsers = {
            BlockType.START: self._parse_start_params,
            BlockType.SEND_MESSAGE: self._parse_send_message_params,
            BlockType.GET_MESSAGE: self._parse_get_message_params,
            BlockType.CHOICE: self._parse_choice_params,
            BlockType.FINAL: self._parse_final_params,
        }
        
        # Регистр валидаторов соединений для каждого типа блока
        self._connection_validators = {
            BlockType.START: self._validate_start_connections,
            BlockType.SEND_MESSAGE: self._validate_message_connections,
            BlockType.GET_MESSAGE: self._validate_message_connections,
            BlockType.CHOICE: self._validate_choice_connections,
            BlockType.FINAL: self._validate_final_connections,
        }
        
        # Допустимые типы для глобальных переменных
        self._allowed_variable_types = {"string", "number", "boolean"}
        
        # Допустимые типы для блока getMessage
        self._allowed_input_types = {"string", "number", "boolean"}
    
    def parse_bot_config_from_file(self, file_path: str) -> Dict[str, Any]:
        """
        Парсинг конфигурации бота из JSON файла
        """
        try:
            # Чтение и парсинг JSON файла
            with open(file_path, 'r', encoding='utf-8') as file:
                json_data = json.load(file)
            
            return self.parse_bot_config(json_data)
            
        except json.JSONDecodeError as e:
            raise ValidationError(f"Ошибка парсинга JSON: {str(e)}")
        except FileNotFoundError:
            raise ValidationError(f"Файл конфигурации не найден: {file_path}")
        except Exception as e:
            raise ValidationError(f"Ошибка чтения файла: {str(e)}")
    
    def parse_bot_config_from_string(self, json_string: str) -> Dict[str, Any]:
        """
        Парсинг конфигурации бота из JSON строки
        """
        try:
            json_data = json.loads(json_string)
            return self.parse_bot_config(json_data)
        except json.JSONDecodeError as e:
            raise ValidationError(f"Ошибка парсинга JSON строки: {str(e)}")
    
    def parse_bot_config(self, json_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Основная функция парсинга конфигурации бота из словаря (после JSON парсинга)
        """
        try:
            # 1. Валидация верхнеуровневых полей
            self._validate_top_level_fields(json_data)
            
            # 2. Валидация и парсинг GlobalVariables
            global_vars = self._parse_global_variables(json_data.get("GlobalVariables", []))
            
            # 3. Парсинг массива Blocks
            blocks_map = self._parse_blocks(json_data["Blocks"])
            
            # 4. Проверка целостности графа
            self._validate_graph_integrity(blocks_map, json_data["Start"], json_data["Final"])
            
            # 5. Сборка финальной конфигурации
            return {
                "BotName": json_data["BotName"],
                "Start": json_data["Start"],
                "Final": json_data["Final"],
                "GlobalVariables": global_vars,
                "Blocks": list(blocks_map.values())
            }
            
        except ValidationError:
            raise
        except Exception as e:
            raise ValidationError(f"Непредвиденная ошибка при парсинге конфигурации: {str(e)}")
    
    def _validate_top_level_fields(self, config: Dict[str, Any]):
        """Валидация верхнеуровневых полей конфигурации"""
        required_fields = ["BotName", "Start", "Final", "Blocks"]
        
        for field in required_fields:
            if field not in config:
                raise ValidationError(f"Отсутствует обязательное поле: {field}")
        
        # Валидация типов
        if not isinstance(config["BotName"], str):
            raise ValidationError("BotName должен быть строкой", "BotName")
        
        if not self._is_valid_uuid(config["Start"]):
            raise ValidationError("Start должен быть валидным UUID", "Start")
        
        if not self._is_valid_uuid(config["Final"]):
            raise ValidationError("Final должен быть валидным UUID", "Final")
        
        if not isinstance(config["Blocks"], list):
            raise ValidationError("Blocks должен быть массивом", "Blocks")
    
    def _parse_global_variables(self, global_vars: List[Dict]) -> List[Dict]:
        """Парсинг и валидация глобальных переменных"""
        parsed_vars = []
        seen_names = set()
        
        for i, var in enumerate(global_vars):
            try:
                # Проверка обязательных полей
                if "name" not in var:
                    raise ValidationError("Отсутствует поле 'name'", f"GlobalVariables[{i}]")
                
                if "type" not in var:
                    raise ValidationError("Отсутствует поле 'type'", f"GlobalVariables[{i}].{var['name']}")
                
                name = var["name"]
                var_type = var["type"]
                
                # Проверка уникальности имени
                if name in seen_names:
                    raise ValidationError(f"Дублирующееся имя переменной: {name}", f"GlobalVariables[{i}]")
                seen_names.add(name)
                
                # Валидация типа
                if var_type not in self._allowed_variable_types:
                    raise ValidationError(
                        f"Недопустимый тип переменной '{var_type}'. Допустимые: {', '.join(self._allowed_variable_types)}",
                        f"GlobalVariables[{i}].{name}.type"
                    )
                
                # Валидация значения по умолчанию
                default_value = var.get("default")
                if default_value is not None:
                    self._validate_variable_value(var_type, default_value, f"GlobalVariables[{i}].{name}.default")
                
                parsed_vars.append({
                    "name": name,
                    "type": var_type,
                    "default": default_value,
                    "description": var.get("description", "")
                })
                
            except ValidationError:
                raise
            except Exception as e:
                raise ValidationError(f"Ошибка при парсинге переменной: {str(e)}", f"GlobalVariables[{i}]")
        
        return parsed_vars
    
    def _parse_blocks(self, blocks: List[Dict]) -> Dict[str, Dict]:
        """Парсинг и валидация массива блоков"""
        blocks_map = {}
        seen_ids = set()
        
        for block in blocks:
            try:
                # Базовая валидация структуры блока
                validated_block = self._validate_block_structure(block)
                block_id = validated_block["Block_id"]
                block_type = BlockType(validated_block["Type"])
                
                # Проверка уникальности Block_id
                if block_id in seen_ids:
                    raise ValidationError(f"Дублирующийся Block_id: {block_id}", "Block_id", block_id, block_type.value)
                seen_ids.add(block_id)
                
                # Валидация параметров блока
                validated_block["Params"] = self._parse_block_params(validated_block)
                
                # Валидация соединений блока
                self._validate_block_connections(validated_block)
                
                blocks_map[block_id] = validated_block
                
            except ValidationError:
                raise
            except ValueError as e:
                if "is not a valid BlockType" in str(e):
                    raise ValidationError(f"Недопустимый тип блока: {validated_block['Type']}", "Type", block_id)
                raise
            except Exception as e:
                raise ValidationError(f"Непредвиденная ошибка при парсинге блока: {str(e)}", block_id=block_id)
        
        return blocks_map
    
    def _validate_block_structure(self, block: Dict) -> Dict:
        """Базовая валидация структуры блока"""
        # Обязательные поля
        required_fields = ["Block_id", "Type", "Connections"]
        for field in required_fields:
            if field not in block:
                raise ValidationError(f"Отсутствует обязательное поле: {field}")
        
        block_id = block["Block_id"]
        block_type = block["Type"]
        
        # Валидация Block_id
        if not self._is_valid_uuid(block_id):
            raise ValidationError("Block_id должен быть валидным UUID", "Block_id", block_id, block_type)
        
        # Валидация Connections
        if not isinstance(block["Connections"], dict):
            raise ValidationError("Connections должен быть объектом", "Connections", block_id, block_type)
        
        if "In" not in block["Connections"] or "Out" not in block["Connections"]:
            raise ValidationError("Connections должен содержать поля In и Out", "Connections", block_id, block_type)
        
        # Опциональные поля
        validated_block = {
            "Block_id": block_id,
            "Type": block_type,
            "Connections": block["Connections"],
            "Params": block.get("Params", {})
        }
        
        if "BlockName" in block:
            if not isinstance(block["BlockName"], str):
                raise ValidationError("BlockName должен быть строкой", "BlockName", block_id, block_type)
            validated_block["BlockName"] = block["BlockName"]
        
        if "X" in block:
            if not isinstance(block["X"], (int, float)):
                raise ValidationError("X должен быть числом", "X", block_id, block_type)
            validated_block["X"] = block["X"]
        
        if "Y" in block:
            if not isinstance(block["Y"], (int, float)):
                raise ValidationError("Y должен быть числом", "Y", block_id, block_type)
            validated_block["Y"] = block["Y"]
        
        return validated_block
    
    def _parse_block_params(self, block: Dict) -> Dict:
        """Парсинг параметров блока в зависимости от его типа"""
        block_type = BlockType(block["Type"])
        block_id = block["Block_id"]
        
        if block_type not in self._param_parsers:
            raise ValidationError(f"Парсер параметров для типа {block_type.value} не реализован", "Type", block_id, block_type.value)
        
        try:
            return self._param_parsers[block_type](block["Params"], block_id)
        except ValidationError:
            raise
        except Exception as e:
            raise ValidationError(f"Ошибка при парсинге параметров: {str(e)}", "Params", block_id, block_type.value)
    
    def _validate_block_connections(self, block: Dict):
        """Валидация соединений блока в зависимости от его типа"""
        block_type = BlockType(block["Type"])
        block_id = block["Block_id"]
        
        if block_type not in self._connection_validators:
            raise ValidationError(f"Валидатор соединений для типа {block_type.value} не реализован", "Connections", block_id, block_type.value)
        
        try:
            self._connection_validators[block_type](block["Connections"], block_id)
        except ValidationError:
            raise
        except Exception as e:
            raise ValidationError(f"Ошибка при валидации соединений: {str(e)}", "Connections", block_id, block_type.value)
    
    # region Парсеры параметров для каждого типа блока
    
    def _parse_start_params(self, params: Dict, block_id: str) -> Dict:
        """Парсинг параметров блока start"""
        if params:
            raise ValidationError("Params должен быть пустым объектом", "Params", block_id, BlockType.START.value)
        return {}
    
    def _parse_send_message_params(self, params: Dict, block_id: str) -> Dict:
        """Парсинг параметров блока sendMessage"""
        if "message" not in params:
            raise ValidationError("Отсутствует обязательное поле 'message'", "Params.message", block_id, BlockType.SEND_MESSAGE.value)
        
        if not isinstance(params["message"], str):
            raise ValidationError("Поле 'message' должно быть строкой", "Params.message", block_id, BlockType.SEND_MESSAGE.value)
        
        return {"message": params["message"]}
    
    def _parse_get_message_params(self, params: Dict, block_id: str) -> Dict:
        """Парсинг параметров блока getMessage"""
        required_fields = ["message", "var"]
        for field in required_fields:
            if field not in params:
                raise ValidationError(f"Отсутствует обязательное поле '{field}'", f"Params.{field}", block_id, BlockType.GET_MESSAGE.value)
        
        if not isinstance(params["message"], str):
            raise ValidationError("Поле 'message' должно быть строкой", "Params.message", block_id, BlockType.GET_MESSAGE.value)
        
        if not isinstance(params["var"], str):
            raise ValidationError("Поле 'var' должно быть строкой", "Params.var", block_id, BlockType.GET_MESSAGE.value)
        
        result = {
            "message": params["message"],
            "var": params["var"]
        }
        
        # Опциональное поле type
        if "type" in params:
            input_type = params["type"]
            if input_type not in self._allowed_input_types:
                raise ValidationError(
                    f"Недопустимый тип ввода '{input_type}'. Допустимые: {', '.join(self._allowed_input_types)}",
                    "Params.type", block_id, BlockType.GET_MESSAGE.value
                )
            result["type"] = input_type
        
        return result
    
    def _parse_choice_params(self, params: Dict, block_id: str) -> Dict:
        """Парсинг параметров блока choice"""
        required_fields = ["prompt", "var", "options"]
        for field in required_fields:
            if field not in params:
                raise ValidationError(f"Отсутствует обязательное поле '{field}'", f"Params.{field}", block_id, BlockType.CHOICE.value)
        
        if not isinstance(params["prompt"], str):
            raise ValidationError("Поле 'prompt' должно быть строкой", "Params.prompt", block_id, BlockType.CHOICE.value)
        
        if not isinstance(params["var"], str):
            raise ValidationError("Поле 'var' должно быть строкой", "Params.var", block_id, BlockType.CHOICE.value)
        
        if not isinstance(params["options"], list):
            raise ValidationError("Поле 'options' должно быть массивом", "Params.options", block_id, BlockType.CHOICE.value)
        
        # Валидация опций
        validated_options = []
        seen_option_ids = set()
        
        for i, option in enumerate(params["options"]):
            if not isinstance(option, dict):
                raise ValidationError(f"Опция {i} должна быть объектом", f"Params.options[{i}]", block_id, BlockType.CHOICE.value)
            
            option_required_fields = ["id", "label", "value"]
            for field in option_required_fields:
                if field not in option:
                    raise ValidationError(f"Отсутствует поле '{field}' в опции {i}", f"Params.options[{i}].{field}", block_id, BlockType.CHOICE.value)
            
            option_id = option["id"]
            if option_id in seen_option_ids:
                raise ValidationError(f"Дублирующийся id опции: {option_id}", f"Params.options[{i}].id", block_id, BlockType.CHOICE.value)
            seen_option_ids.add(option_id)
            
            validated_options.append({
                "id": option_id,
                "label": option["label"],
                "value": option["value"]
            })
        
        return {
            "prompt": params["prompt"],
            "var": params["var"],
            "options": validated_options
        }
    
    def _parse_final_params(self, params: Dict, block_id: str) -> Dict:
        """Парсинг параметров блока final"""
        if params:
            raise ValidationError("Params должен быть пустым объектом", "Params", block_id, BlockType.FINAL.value)
        return {}
    
    # endregion
    
    # region Валидаторы соединений для каждого типа блока
    
    def _validate_start_connections(self, connections: Dict, block_id: str):
        """Валидация соединений блока start"""
        if not isinstance(connections["In"], list) or connections["In"]:
            raise ValidationError("In должен быть пустым массивом", "Connections.In", block_id, BlockType.START.value)
        
        if not isinstance(connections["Out"], list) or len(connections["Out"]) < 1:
            raise ValidationError("Out должен содержать минимум 1 элемент", "Connections.Out", block_id, BlockType.START.value)
        
        for i, conn in enumerate(connections["Out"]):
            if not self._is_valid_uuid(conn):
                raise ValidationError(f"Некорректный UUID в Out[{i}]", f"Connections.Out[{i}]", block_id, BlockType.START.value)
    
    def _validate_message_connections(self, connections: Dict, block_id: str):
        """Валидация соединений блоков sendMessage и getMessage"""
        if not isinstance(connections["In"], list) or len(connections["In"]) < 1:
            raise ValidationError("In должен содержать минимум 1 элемент", "Connections.In", block_id)
        
        if not isinstance(connections["Out"], list) or len(connections["Out"]) < 1:
            raise ValidationError("Out должен содержать минимум 1 элемент", "Connections.Out", block_id)
        
        # Валидация UUID в In
        for i, conn in enumerate(connections["In"]):
            if not self._is_valid_uuid(conn):
                raise ValidationError(f"Некорректный UUID в In[{i}]", f"Connections.In[{i}]", block_id)
        
        # Валидация UUID в Out
        for i, conn in enumerate(connections["Out"]):
            if not self._is_valid_uuid(conn):
                raise ValidationError(f"Некорректный UUID в Out[{i}]", f"Connections.Out[{i}]", block_id)
    
    def _validate_choice_connections(self, connections: Dict, block_id: str):
        """Валидация соединений блока choice"""
        if not isinstance(connections["In"], list) or len(connections["In"]) < 1:
            raise ValidationError("In должен содержать минимум 1 элемент", "Connections.In", block_id, BlockType.CHOICE.value)
        
        # Валидация UUID в In
        for i, conn in enumerate(connections["In"]):
            if not self._is_valid_uuid(conn):
                raise ValidationError(f"Некорректный UUID в In[{i}]", f"Connections.In[{i}]", block_id, BlockType.CHOICE.value)
        
        # Для Out проверка будет выполнена после парсинга параметров
        # (требуется знать количество опций)
    
    def _validate_final_connections(self, connections: Dict, block_id: str):
        """Валидация соединений блока final"""
        if not isinstance(connections["In"], list) or len(connections["In"]) < 1:
            raise ValidationError("In должен содержать минимум 1 элемент", "Connections.In", block_id, BlockType.FINAL.value)
        
        if not isinstance(connections["Out"], list) or connections["Out"]:
            raise ValidationError("Out должен быть пустым массивом", "Connections.Out", block_id, BlockType.FINAL.value)
        
        # Валидация UUID в In
        for i, conn in enumerate(connections["In"]):
            if not self._is_valid_uuid(conn):
                raise ValidationError(f"Некорректный UUID в In[{i}]", f"Connections.In[{i}]", block_id, BlockType.FINAL.value)
    
    # endregion
    
    def _validate_graph_integrity(self, blocks_map: Dict[str, Dict], start_id: str, final_id: str):
        """Проверка целостности графа блоков"""
        # Проверка существования стартового блока
        if start_id not in blocks_map:
            raise ValidationError(f"Стартовый блок с ID {start_id} не найден в массиве Blocks")
        
        # Проверка существования финального блока
        if final_id not in blocks_map:
            raise ValidationError(f"Финальный блок с ID {final_id} не найден в массиве Blocks")
        
        # Проверка типа стартового блока
        start_block = blocks_map[start_id]
        if BlockType(start_block["Type"]) != BlockType.START:
            raise ValidationError(f"Стартовый блок должен иметь тип 'start'", block_id=start_id)
        
        # Проверка типа финального блока
        final_block = blocks_map[final_id]
        if BlockType(final_block["Type"]) != BlockType.FINAL:
            raise ValidationError(f"Финальный блок должен иметь тип 'final'", block_id=final_id)
        
        # Проверка всех соединений на существование целевых блоков
        all_block_ids = set(blocks_map.keys())
        
        for block_id, block in blocks_map.items():
            block_type = BlockType(block["Type"])
            connections = block["Connections"]
            
            # Проверка входящих соединений (должны существовать блоки, которые ссылаются на текущий)
            for i, in_conn in enumerate(connections["In"]):
                if in_conn not in all_block_ids:
                    raise ValidationError(
                        f"Входящее соединение In[{i}] ссылается на несуществующий блок {in_conn}",
                        f"Connections.In[{i}]", block_id, block_type.value
                    )
            
            # Проверка исходящих соединений
            for i, out_conn in enumerate(connections["Out"]):
                if out_conn not in all_block_ids:
                    raise ValidationError(
                        f"Исходящее соединение Out[{i}] ссылается на несуществующий блок {out_conn}",
                        f"Connections.Out[{i}]", block_id, block_type.value
                    )
            
            # Специфичная валидация для блока choice
            if block_type == BlockType.CHOICE:
                options_count = len(block["Params"]["options"])
                out_count = len(connections["Out"])
                if options_count != out_count:
                    raise ValidationError(
                        f"Количество опций ({options_count}) не соответствует количеству выходных соединений ({out_count})",
                        "Connections.Out", block_id, block_type.value
                    )
    
    def _is_valid_uuid(self, uuid_str: str) -> bool:
        """Проверка валидности UUID"""
        try:
            uuid.UUID(uuid_str)
            return True
        except (ValueError, TypeError):
            return False
    
    def _validate_variable_value(self, var_type: str, value: Any, field_path: str):
        """Валидация значения переменной в соответствии с типом"""
        if var_type == "string":
            if not isinstance(value, str):
                raise ValidationError(f"Значение должно быть строкой", field_path)
        elif var_type == "number":
            if not isinstance(value, (int, float)):
                raise ValidationError(f"Значение должно быть числом", field_path)
        elif var_type == "boolean":
            if not isinstance(value, bool):
                raise ValidationError(f"Значение должно быть булевым", field_path)
    
    def register_block_type(self, block_type: str, param_parser: Callable, connection_validator: Callable):
        """Регистрация нового типа блока для расширения функциональности"""
        enum_block_type = BlockType(block_type)
        self._param_parsers[enum_block_type] = param_parser
        self._connection_validators[enum_block_type] = connection_validator

# Функции для удобного использования
def parse_bot_config_from_file(file_path: str) -> Dict[str, Any]:
    """
    Основная функция для парсинга конфигурации бота из JSON файла
    """
    parser = BotConfigParser()
    return parser.parse_bot_config_from_file(file_path)

def parse_bot_config_from_string(json_string: str) -> Dict[str, Any]:
    """
    Основная функция для парсинга конфигурации бота из JSON строки
    """
    parser = BotConfigParser()
    return parser.parse_bot_config_from_string(json_string)

# Пример использования с JSON файлом
if __name__ == "__main__":
    MODE = 1
    NEED_CREATE = False
    
    # Сохраняем пример конфигурации в файл
    if MODE == 1:
        config_file = "bot_config.json"
        try:
            if NEED_CREATE:
                with open(config_file, 'w', encoding='utf-8') as f:
                    f.write(sample_json_config)
                print(f"Пример конфигурации сохранен в файл: {config_file}")
            
            # Парсим конфигурацию из файла
            parsed_config = parse_bot_config_from_file(config_file)
            print("✅ Конфигурация успешно распарсена из JSON файла!")
            print(json.dumps(parsed_config, indent=2, ensure_ascii=False))
            
        except ValidationError as e:
            print(f"❌ Ошибка валидации: {e}")
        except Exception as e:
            print(f"❌ Неожиданная ошибка: {e}")
        
    elif MODE == 2:
        # Также можно парсить из строки
        from bot_model import sample_json_config
        
        print("\n" + "="*50)
        print("Парсинг из JSON строки:")
        
        try:
            parsed_from_string = parse_bot_config_from_string(sample_json_config)
            print("✅ Конфигурация успешно распарсена из JSON строки!")
        except ValidationError as e:
            print(f"❌ Ошибка валидации: {e}")
        except Exception as e:
            print(f"❌ Неожиданная ошибка: {e}")
