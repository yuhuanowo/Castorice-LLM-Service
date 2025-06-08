import aiohttp
import asyncio
import base64
import os
import time
import json
import re
from datetime import datetime
import uuid
from typing import Dict, Any, List, Optional, Union
import httpx
from bs4 import BeautifulSoup
try:
    import markdown
    MARKDOWN_AVAILABLE = True
except ImportError:
    MARKDOWN_AVAILABLE = False

from app.utils.logger import logger
from app.core.config import get_settings

settings = get_settings()

# ---------- 基础工具 ----------

# MARK: 生成图像
async def generate_image(prompt: str) -> Optional[str]:
    """
    使用Cloudflare API生成图像
    
    Args:
        prompt: 图像描述
        
    Returns:
        base64编码的图像数据URI或None
    """
    try:
        logger.info(f"开始生成图片，提示词: {prompt[:50]}...")
        
        # 构建请求
        url = f"https://api.cloudflare.com/client/v4/accounts/{settings.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell"
        headers = {
            "Authorization": f"Bearer {settings.CLOUDFLARE_API_KEY}",
            "Content-Type": "application/json"
        }
        data = {"prompt": prompt}
        
        # 发送请求
        async with aiohttp.ClientSession() as session:
            logger.info(f"向Cloudflare API发送图片生成请求")
            async with session.post(url, json=data, headers=headers) as response:
                if response.status != 200:
                    logger.error(f"图像生成API错误: {response.status}, 响应: {await response.text()[:200]}")
                    return None
                
                result = await response.json()
                logger.info(f"收到Cloudflare API响应: {str(result)[:100]}...")
                
                if not result:
                    logger.error("API返回空响应")
                    return None
                    
                if not result.get("result"):
                    logger.error(f"API响应中缺少result字段: {str(result)[:200]}")
                    return None
                    
                if not result["result"].get("image"):
                    logger.error(f"API响应中缺少image字段: {str(result['result'])[:200]}")
                    return None
                
                # 返回dataURI
                image_data = f"data:image/jpeg;base64,{result['result']['image']}"
                logger.info(f"成功生成图片，dataURI长度: {len(image_data)}")
                
                # 本地保存图片
                await save_image_locally(result["result"]["image"], prompt)
                
                return image_data
    except Exception as e:
        logger.error(f"图像生成错误: {str(e)}", exc_info=True)
        return None

# MARK: 保存图像到本地
async def save_image_locally(base64_image: str, prompt: str) -> None:
    """
    将base64编码的图像保存到本地
    
    Args:
        base64_image: base64编码的图像数据
        prompt: 生成图像的提示词，用于文件命名
    """
    try:
        # 创建保存目录
        image_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "images")
        os.makedirs(image_dir, exist_ok=True)
        
        # 生成文件名 (时间戳 + 提示词前20个字符的安全版本)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_prompt = "".join([c if c.isalnum() else "_" for c in prompt[:20]]).strip("_")
        filename = f"{timestamp}_{safe_prompt}.jpg"
        filepath = os.path.join(image_dir, filename)
        
        # 解码并保存图像
        image_bytes = base64.b64decode(base64_image)
        with open(filepath, "wb") as f:
            f.write(image_bytes)
            
        logger.info(f"图片已保存到本地: {filepath}")
    except Exception as e:
        logger.error(f"保存图片到本地时出错: {str(e)}", exc_info=True)
        # 保存失败不影响主功能

# MARK: DuckDuckGo搜索
async def search_duckduckgo(query: str, num_results: int = 10) -> List[Dict[str, str]]:
    """
    使用DuckDuckGo搜索引擎进行网络搜索
    
    Args:
        query: 搜索查询
        num_results: 返回结果数量
        
    Returns:
        搜索结果列表，每个结果包含title、snippet、url和可能的content
    """
    try:
        # 构建URL
        url = f"https://html.duckduckgo.com/html/?q={query}"
        headers = {"User-Agent": "Mozilla/5.0"}
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                if response.status != 200:
                    logger.error(f"搜索API错误: {response.status}")
                    return []
                
                html = await response.text()
                
                # 使用正则表达式解析结果
                import re
                from bs4 import BeautifulSoup
                
                soup = BeautifulSoup(html, 'html.parser')
                results = []
                
                # 查找所有结果
                results_elements = soup.select('.result')[:num_results]
                
                for element in results_elements:
                    title_element = element.select_one('.result__a')
                    snippet_element = element.select_one('.result__snippet')
                    
                    if title_element and snippet_element:
                        title = title_element.text.strip()
                        snippet = snippet_element.text.strip()
                        url_raw = title_element.get('href', '')
                        
                        # 从URL提取真实链接
                        url_match = re.search(r'uddg=([^&]+)', url_raw)
                        url = url_match.group(1) if url_match else url_raw
                        url = url.replace('/l/?kh=-1&uddg=', '')
                        
                        try:
                            url = base64.b64decode(url).decode('utf-8') 
                        except:
                            pass
                        
                        results.append({
                            "title": title,
                            "snippet": snippet,
                            "url": url
                        })
                
                
                return results
    except Exception as e:
        logger.error(f"搜索错误: {str(e)}")
        return []

# MARK: 获取网页内容
async def fetch_webpage_content(url: str) -> Optional[str]:
    """
    获取网页内容并提取正文文本
    
    Args:
        url: 网页URL
        
    Returns:
        提取的网页正文文本或None
    """
    try:
        logger.info(f"开始获取网页内容: {url}")
        
        # 添加http前缀（如果没有）
        if not url.startswith('http'):
            url = 'https://' + url
            
        async with httpx.AsyncClient() as client:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            }
            response = await client.get(url, headers=headers, timeout=10.0, follow_redirects=True)
            
            if response.status_code != 200:
                logger.error(f"获取网页失败，状态码: {response.status_code}")
                return None
            
            # 使用BeautifulSoup解析HTML
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # 移除脚本和样式元素
            for script in soup(["script", "style", "header", "footer", "nav"]):
                script.decompose()
                
            # 提取正文
            text = soup.get_text(separator='\n')
            
            # 清理文本
            lines = (line.strip() for line in text.splitlines())
            chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
            text = '\n'.join(chunk for chunk in chunks if chunk)
            
            logger.info(f"成功获取网页内容，长度: {len(text)}")
            
            # 根据内容长度进行截断
            max_length = 5000  # 设置合理的截断长度
            if len(text) > max_length:
                text = text[:max_length] + "...[内容已截断]"
            
            # 使用Gemma-3模型提取重点内容，减少token消耗
            try:
                from app.services.llm_service import llm_service
                
                # 根据内容长度决定是否需要提取重点
                if len(text) > 1000:  # 对于较长的内容才进行处理
                    logger.info(f"使用Gemma-3模型提取网页内容重点")
                    
                    messages = [
                        {
                            "role": "system",
                            "content": "请提取以下网页内容的核心要点和关键信息。保留最重要的事实、数据和观点，去除冗余内容。输出应简洁且包含原文的主要信息。"
                        },
                        {
                            "role": "user",
                            "content": text
                        }
                    ]
                    
                    # 使用较小的模型进行处理
                    model_name = "gemma-3n-e4b-it"
                    summary_response = await llm_service.send_llm_request(messages, model_name)
                    
                    if "choices" in summary_response and summary_response["choices"]:
                        summarized_text = summary_response["choices"][0]["message"].get("content", "")
                        
                        # 确保摘要不为空且有意义
                        if summarized_text and len(summarized_text) > 100:
                            logger.info(f"成功提取网页内容重点，原长度: {len(text)}, 提取后长度: {len(summarized_text)}")
                            return f"[以下是网页内容的重点提取]\n\n{summarized_text}\n\n[原始URL: {url}]"
            except Exception as e:
                logger.warning(f"使用模型提取网页内容重点失败: {str(e)}，将返回原始内容")
                # 提取失败时继续使用原始内容
                
            return text
    except Exception as e:
        logger.error(f"获取网页内容错误: {str(e)}")
        return None

# MARK: 分析文本
async def analyze_text(text: str, task: str) -> Dict[str, Any]:
    """
    分析文本内容
    
    Args:
        text: 待分析的文本
        task: 分析任务描述
        
    Returns:
        分析结果
    """
    try:
        logger.info(f"开始分析文本，任务: {task}")
        
        # 这里可以使用单独的模型来完成文本分析任务
        # 或者使用现有的LLM服务
        
        from app.services.llm_service import llm_service
        
        # 创建分析请求
        messages = [
            {
                "role": "system",
                "content": f"请分析以下文本，任务: {task}。仅返回分析结果，不要包含其他解释内容。"
            },
            {
                "role": "user",
                "content": text
            }
        ]
        
        # 使用小模型完成分析任务
        analysis_model = "gemma-3n-e4b-it"  # 使用小模型进行分析
        
        analysis_response = await llm_service.send_llm_request(messages, analysis_model)
        
        if "choices" in analysis_response and analysis_response["choices"]:
            analysis_text = analysis_response["choices"][0]["message"].get("content", "")
            
            return {
                "success": True,
                "analysis": analysis_text,
                "task": task
            }
        else:
            return {
                "success": False,
                "error": "分析响应格式错误"
            }
    except Exception as e:
        logger.error(f"文本分析错误: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }

# MARK: 格式化内容
async def format_content(content: str, output_format: str) -> Dict[str, Any]:
    """
    将内容转换为指定格式
    
    Args:
        content: 输入内容
        output_format: 输出格式，如 'json', 'markdown', 'html', 'csv'
        
    Returns:
        格式化后的内容
    """
    try:
        logger.info(f"开始格式化内容至: {output_format}")
        
        if output_format.lower() == 'json':
            # 尝试解析为JSON
            try:
                # 如果已经是JSON字符串，则解析后再格式化
                if isinstance(content, str):
                    data = json.loads(content)
                    formatted = json.dumps(data, indent=2, ensure_ascii=False)
                else:
                    # 如果是其他类型，直接格式化为JSON
                    formatted = json.dumps(content, indent=2, ensure_ascii=False)
                    
                return {
                    "success": True,
                    "formatted_content": formatted,
                    "format": "json"
                }
            except json.JSONDecodeError:
                # 如果不是有效的JSON，则尝试使用模型转换
                from app.services.llm_service import llm_service
                
                messages = [
                    {
                        "role": "system",
                        "content": f"请将以下内容转换为有效的JSON格式。保留所有重要信息，但确保输出是有效的JSON。"
                    },
                    {
                        "role": "user",
                        "content": content
                    }
                ]
                
                format_response = await llm_service.send_llm_request(messages, "gemma-3n-e4b-it", skip_content_check=True)
                
                if "choices" in format_response and format_response["choices"]:
                    format_text = format_response["choices"][0]["message"].get("content", "")
                    
                    # 提取JSON部分
                    json_match = re.search(r'```json\s*([\s\S]*?)\s*```', format_text)
                    if json_match:
                        format_text = json_match.group(1)
                    
                    try:
                        # 验证是否为有效JSON
                        json.loads(format_text)
                        return {
                            "success": True,
                            "formatted_content": format_text,
                            "format": "json"
                        }
                    except:
                        return {
                            "success": False,
                            "error": "无法转换为有效的JSON格式"
                        }
                else:
                    return {
                        "success": False,
                        "error": "格式转换请求失败"
                    }
        
        elif output_format.lower() == 'markdown':
            # 如果已经是Markdown，则直接返回
            return {
                "success": True,
                "formatted_content": content,
                "format": "markdown"
            }
            
        elif output_format.lower() == 'html':
            # 将Markdown转换为HTML
            try:
                if MARKDOWN_AVAILABLE:
                    html = markdown.markdown(content)
                    return {
                        "success": True,
                        "formatted_content": html,
                        "format": "html"
                    }
                else:
                    return {
                        "success": False,
                        "error": "markdown库未安装，无法转换为HTML"
                    }
            except Exception as e:
                return {
                    "success": False,
                    "error": f"Markdown转HTML错误: {str(e)}"
                }
                
        elif output_format.lower() == 'csv':
            # 尝试转换为CSV格式
            from app.services.llm_service import llm_service
            
            messages = [
                {
                    "role": "system",
                    "content": f"请将以下内容转换为CSV格式。第一行应该是列标题，之后每行是数据。"
                },
                {
                    "role": "user",
                    "content": content
                }
            ]
            
            format_response = await llm_service.send_llm_request(messages, "gemma-3n-e4b-it", skip_content_check=True)
            
            if "choices" in format_response and format_response["choices"]:
                format_text = format_response["choices"][0]["message"].get("content", "")
                
                # 提取CSV部分
                csv_match = re.search(r'```csv\s*([\s\S]*?)\s*```', format_text)
                if csv_match:
                    format_text = csv_match.group(1)
                
                return {
                    "success": True,
                    "formatted_content": format_text,
                    "format": "csv"
                }
            else:
                return {
                    "success": False,
                    "error": "格式转换请求失败"
                }
        else:
            return {
                "success": False,
                "error": f"不支持的输出格式: {output_format}"
            }
    except Exception as e:
        logger.error(f"内容格式化错误: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }

# MARK: 评估Agent性能
async def evaluate_agent_performance(
    execution_trace: List[Dict[str, Any]],
    expected_outcome: Optional[str] = None
) -> Dict[str, Any]:
    """
    评估Agent的执行性能
    
    Args:
        execution_trace: 执行跟踪记录
        expected_outcome: 期望的结果描述（可选）
        
    Returns:
        评估结果
    """
    try:
        logger.info("开始评估Agent执行性能")
        
        # 提取关键指标
        start_time = datetime.fromisoformat(execution_trace[0]["timestamp"]) if execution_trace else datetime.now()
        end_time = datetime.fromisoformat(execution_trace[-1]["timestamp"]) if execution_trace else datetime.now()
        execution_time = (end_time - start_time).total_seconds()
        
        # 计算步骤数
        steps_taken = sum(1 for trace in execution_trace if trace.get("action", "").startswith("执行"))
        
        # 统计各状态的时间
        state_times = {}
        current_state = None
        state_start_time = None
        
        for trace in execution_trace:
            state = trace.get("state")
            if state and state != current_state:
                # 如果状态变化，计算前一状态的持续时间
                if current_state and state_start_time:
                    time_in_state = (datetime.fromisoformat(trace["timestamp"]) - state_start_time).total_seconds()
                    if current_state in state_times:
                        state_times[current_state] += time_in_state
                    else:
                        state_times[current_state] = time_in_state
                
                # 更新当前状态和开始时间
                current_state = state
                state_start_time = datetime.fromisoformat(trace["timestamp"])
        
        # 统计工具调用次数和成功率
        tool_calls = [trace for trace in execution_trace if "tool_calls" in trace]
        tool_results = [trace for trace in execution_trace if "tool_results" in trace]
        
        tool_stats = {
            "total_calls": len(tool_calls),
            "success_rate": len(tool_results) / len(tool_calls) if tool_calls else 0
        }
        
        # 构建评估结果
        evaluation = {
            "execution_time": execution_time,
            "steps_taken": steps_taken,
            "state_distribution": state_times,
            "tool_stats": tool_stats,
            "evaluation_time": datetime.now().isoformat()
        }
        
        # 如果提供了期望结果，添加结果匹配评估
        if expected_outcome:
            last_action = execution_trace[-1].get("action", "") if execution_trace else ""
            evaluation["outcome_match"] = {
                "expected": expected_outcome,
                "actual": last_action,
                "match_score": 0.0  # 这里可以实现更复杂的匹配算法
            }
            
        logger.info(f"Agent性能评估完成, 执行时间: {execution_time:.2f}秒, 步骤数: {steps_taken}")
        return {
            "success": True,
            "evaluation": evaluation
        }
    except Exception as e:
        logger.error(f"Agent性能评估错误: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }

# ---------- 新增工具 ----------

# MARK: 生成结构化数据
async def generate_structured_data(
    data_type: str, 
    requirements: str,
    schema: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    生成结构化数据
    
    Args:
        data_type: 数据类型，如 'json', 'csv', 'table', 'form'
        requirements: 数据需求描述
        schema: 可选的数据模式定义
        
    Returns:
        生成的结构化数据
    """
    try:
        logger.info(f"开始生成结构化数据，类型: {data_type}, 需求: {requirements[:50]}...")
        
        from app.services.llm_service import llm_service
        
        # 构建提示词
        schema_text = ""
        if schema:
            schema_text = f"\n数据模式: {json.dumps(schema, ensure_ascii=False, indent=2)}"
            
        messages = [
            {
                "role": "system",
                "content": f"你是一个专门生成结构化数据的助手。请根据需求生成指定类型的数据。{schema_text}"
            },
            {
                "role": "user",
                "content": f"请根据以下需求生成{data_type}格式的数据:\n{requirements}"
            }
        ]
        
        # 使用小模型生成数据
        model_name = "gemma-3n-e4b-it"
        response = await llm_service.send_llm_request(messages, model_name)
        
        if "choices" in response and response["choices"]:
            content = response["choices"][0]["message"].get("content", "")
            
            # 处理不同数据类型
            if data_type.lower() == "json":
                # 提取JSON部分
                json_match = re.search(r'```json\s*([\s\S]*?)\s*```', content)
                if json_match:
                    content = json_match.group(1)
                
                try:
                    data = json.loads(content)
                    return {
                        "success": True,
                        "data_type": data_type,
                        "data": data
                    }
                except json.JSONDecodeError:
                    return {
                        "success": False,
                        "error": "无法解析生成的JSON数据"
                    }
            else:
                # 其他格式直接返回文本
                return {
                    "success": True,
                    "data_type": data_type,
                    "data": content
                }
        else:
            return {
                "success": False,
                "error": "数据生成请求失败"
            }
    except Exception as e:
        logger.error(f"结构化数据生成错误: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }

# MARK: 文本摘要
async def summarize_content(text: str, max_length: int = 500) -> Dict[str, Any]:
    """
    对长文本内容进行摘要
    
    Args:
        text: 待摘要的文本
        max_length: 摘要最大长度
        
    Returns:
        文本摘要结果
    """
    try:
        logger.info(f"开始生成文本摘要，文本长度: {len(text)}, 最大摘要长度: {max_length}")
        
        from app.services.llm_service import llm_service
        
        # 截断过长的输入
        if len(text) > 20000:
            text = text[:20000] + "...[内容已截断]"
        
        messages = [
            {
                "role": "system",
                "content": f"你是一个专业的文本摘要工具。请将以下文本总结为不超过{max_length}个字符的摘要，保留最关键的信息。"
            },
            {
                "role": "user",
                "content": text
            }
        ]
        
        # 使用小模型生成摘要
        model_name = "gemma-3n-e4b-it"
        response = await llm_service.send_llm_request(messages, model_name)
        
        if "choices" in response and response["choices"]:
            summary = response["choices"][0]["message"].get("content", "")
            
            return {
                "success": True,
                "original_length": len(text),
                "summary_length": len(summary),
                "summary": summary
            }
        else:
            return {
                "success": False,
                "error": "摘要生成请求失败"
            }
    except Exception as e:
        logger.error(f"文本摘要生成错误: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }

# MARK: 文本翻译
async def translate_text(text: str, target_language: str) -> Dict[str, Any]:
    """
    将文本翻译成指定语言
    
    Args:
        text: 待翻译的文本
        target_language: 目标语言，如 'en', 'zh-CN', 'ja', 'fr'
        
    Returns:
        翻译结果
    """
    try:
        logger.info(f"开始翻译文本，目标语言: {target_language}, 文本长度: {len(text)}")
        
        from app.services.llm_service import llm_service
        
        # 截断过长的输入
        if len(text) > 10000:
            text = text[:10000] + "...[内容已截断]"
        
        messages = [
            {
                "role": "system",
                "content": f"你是一个专业的翻译工具。请将以下文本准确翻译成{target_language}。只输出翻译结果，不要添加任何解释。"
            },
            {
                "role": "user",
                "content": text
            }
        ]
        
        # 使用小模型进行翻译
        model_name = "gemma-3n-e4b-it"
        response = await llm_service.send_llm_request(messages, model_name)
        
        if "choices" in response and response["choices"]:
            translated_text = response["choices"][0]["message"].get("content", "")
            
            return {
                "success": True,
                "source_language": "auto-detect",
                "target_language": target_language,
                "original_text": text,
                "translated_text": translated_text
            }
        else:
            return {
                "success": False,
                "error": "翻译请求失败"
            }
    except Exception as e:
        logger.error(f"翻译错误: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }

# MARK: 从数据中回答问题
async def answer_from_data(question: str, data: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    根据提供的数据回答问题
    
    Args:
        question: 问题
        data: 数据列表，每项是一个字典
        
    Returns:
        根据数据的回答
    """
    try:
        logger.info(f"开始从数据中回答问题，问题: {question}, 数据项数: {len(data)}")
        
        from app.services.llm_service import llm_service
        
        # 准备数据上下文
        data_json = json.dumps(data[:50], ensure_ascii=False)  # 限制数据量
        
        messages = [
            {
                "role": "system",
                "content": "你是一个数据分析助手，擅长从结构化数据中找到问题的答案。请分析提供的数据并回答问题。"
            },
            {
                "role": "user",
                "content": f"基于以下数据回答问题:\n\n数据:\n{data_json}\n\n问题: {question}"
            }
        ]
        
        # 使用模型生成回答
        model_name = "gemma-3n-e4b-it"
        response = await llm_service.send_llm_request(messages, model_name)
        
        if "choices" in response and response["choices"]:
            answer = response["choices"][0]["message"].get("content", "")
            
            return {
                "success": True,
                "question": question,
                "data_items_count": len(data),
                "answer": answer
            }
        else:
            return {
                "success": False,
                "error": "回答生成请求失败"
            }
    except Exception as e:
        logger.error(f"数据问答错误: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }

# MARK: 保存和检索用户记忆
async def save_to_memory(user_id: str, key: str, value: Any) -> Dict[str, Any]:
    """
    将数据保存到用户记忆中
    
    Args:
        user_id: 用户ID
        key: 记忆键名
        value: 记忆值
        
    Returns:
        保存结果
    """
    try:
        logger.info(f"将数据保存到用户记忆, 用户ID: {user_id}, 键: {key}")
        
        # 获取用户当前记忆
        from app.models.mongodb import get_user_memory, update_user_memory
        memory = get_user_memory(user_id) or {}
        
        # 更新记忆
        if isinstance(memory, str):
            # 如果是字符串格式，转换为字典
            try:
                memory_dict = json.loads(memory)
            except:
                memory_dict = {}
        else:
            memory_dict = memory
            
        # 更新记忆字典
        memory_dict[key] = value
        
        # 保存更新后的记忆
        update_user_memory(user_id, memory_dict)
        
        return {
            "success": True,
            "user_id": user_id,
            "key": key,
            "message": "数据已保存到用户记忆"
        }
    except Exception as e:
        logger.error(f"保存用户记忆错误: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }

# MARK: 检索用户记忆
async def retrieve_from_memory(user_id: str, key: Optional[str] = None) -> Dict[str, Any]:
    """
    从用户记忆中检索数据
    
    Args:
        user_id: 用户ID
        key: 记忆键名，如果为None则返回所有记忆
        
    Returns:
        检索结果
    """
    try:
        logger.info(f"从用户记忆中检索数据, 用户ID: {user_id}, 键: {key if key else 'all'}")
        
        # 获取用户记忆
        from app.models.mongodb import get_user_memory
        memory = get_user_memory(user_id)
        
        if not memory:
            return {
                "success": True,
                "user_id": user_id,
                "data": {} if key else {}
            }
        
        # 处理不同格式的记忆数据
        if isinstance(memory, str):
            try:
                memory_dict = json.loads(memory)
            except:
                memory_dict = {}
        else:
            memory_dict = memory
            
        # 根据key检索特定数据或返回所有记忆
        if key:
            if key in memory_dict:
                return {
                    "success": True,
                    "user_id": user_id,
                    "key": key,
                    "data": memory_dict[key]
                }
            else:
                return {
                    "success": False,
                    "user_id": user_id,
                    "error": f"记忆中不存在键 '{key}'"
                }
        else:
            # 返回所有记忆数据
            return {
                "success": True,
                "user_id": user_id,
                "data": memory_dict
            }
    except Exception as e:
        logger.error(f"检索用户记忆错误: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }

# MARK: 创建日程计划
async def create_date_plan(
    location: str, 
    interests: List[str],
    budget: Optional[str] = None,
    duration: Optional[str] = None
) -> Dict[str, Any]:
    """
    创建日程计划
    
    Args:
        location: 地点
        interests: 兴趣列表
        budget: 预算（可选）
        duration: 持续时间（可选）
        
    Returns:
        日程计划
    """
    try:
        logger.info(f"开始创建日程计划，地点: {location}, 兴趣: {interests}")
        
        from app.services.llm_service import llm_service
        
        # 构建提示词
        budget_text = f"预算: {budget}" if budget else "预算: 无特定限制"
        duration_text = f"持续时间: {duration}" if duration else "持续时间: 一整天"
        interests_text = "、".join(interests)
        
        messages = [
            {
                "role": "system",
                "content": "你是一个专业的旅行规划师，善于根据用户的兴趣和需求创建定制的日程计划。"
            },
            {
                "role": "user",
                "content": f"请为我创建一个在{location}的日程计划。\n\n兴趣: {interests_text}\n{budget_text}\n{duration_text}\n\n请包含具体的地点、时间安排和活动建议，并以JSON格式输出计划，包含日期、时间、地点、活动和备注字段。"
            }
        ]
        
        # 使用模型生成计划
        model_name = "gemma-3n-e4b-it"
        response = await llm_service.send_llm_request(messages, model_name)
        
        if "choices" in response and response["choices"]:
            plan_text = response["choices"][0]["message"].get("content", "")
            
            # 尝试提取JSON格式的计划
            json_match = re.search(r'```json\s*([\s\S]*?)\s*```', plan_text)
            if json_match:
                plan_json = json_match.group(1)
                try:
                    plan = json.loads(plan_json)
                    return {
                        "success": True,
                        "location": location,
                        "interests": interests,
                        "budget": budget,
                        "duration": duration,
                        "plan": plan
                    }
                except:
                    # 如果解析JSON失败，直接返回文本
                    return {
                        "success": True,
                        "location": location,
                        "plan_text": plan_text
                    }
            else:
                # 如果没有找到JSON格式，直接返回文本
                return {
                    "success": True,
                    "location": location,
                    "plan_text": plan_text
                }
        else:
            return {
                "success": False,
                "error": "日程计划生成请求失败"
            }
    except Exception as e:
        logger.error(f"日程计划生成错误: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }

# MARK: 整合信息源
async def integrate_information(
    sources: List[str],
    question: str,
    format: str = "markdown"
) -> Dict[str, Any]:
    """
    整合多个信息源并回答问题
    
    Args:
        sources: 信息源列表，每项是一段文本
        question: 需要回答的问题
        format: 输出格式，如'markdown', 'json', 'html'
        
    Returns:
        整合后的信息
    """
    try:
        logger.info(f"开始整合信息，信息源数量: {len(sources)}, 问题: {question}")
        
        from app.services.llm_service import llm_service
        
        # 准备信息源文本
        combined_sources = ""
        for i, source in enumerate(sources):
            # 截断过长的信息源
            if len(source) > 2000:
                source = source[:2000] + "...[内容已截断]"
            combined_sources += f"\n\n信息源 {i+1}:\n{source}"
        
        messages = [
            {
                "role": "system",
                "content": f"你是一个信息整合专家，擅长从多个信息源中整合信息并回答问题。请以{format}格式输出回答。"
            },
            {
                "role": "user",
                "content": f"基于以下信息源回答问题:\n{combined_sources}\n\n问题: {question}\n\n请确保回答全面、准确，并引用相关信息源。"
            }
        ]
        
        # 使用模型整合信息
        model_name = "gemma-3n-e4b-it"  # 使用更强大的模型以获得更好的整合效果
        response = await llm_service.send_llm_request(messages, model_name)
        
        if "choices" in response and response["choices"]:
            integrated_info = response["choices"][0]["message"].get("content", "")
            
            return {
                "success": True,
                "sources_count": len(sources),
                "question": question,
                "format": format,
                "integrated_information": integrated_info
            }
        else:
            return {
                "success": False,
                "error": "信息整合请求失败"
            }
    except Exception as e:
        logger.error(f"信息整合错误: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }

# MARK: 生成代码
async def generate_code(
    requirement: str, 
    language: str,
    framework: Optional[str] = None
) -> Dict[str, Any]:
    """
    生成代码
    
    Args:
        requirement: 代码需求描述
        language: 编程语言，如'python', 'javascript', 'java'
        framework: 可选的框架，如'react', 'fastapi', 'spring'
        
    Returns:
        生成的代码
    """
    try:
        logger.info(f"开始生成代码，语言: {language}, 框架: {framework if framework else 'none'}")
        
        from app.services.llm_service import llm_service
        
        # 构建提示词
        framework_text = f"，使用{framework}框架" if framework else ""
        
        messages = [
            {
                "role": "system",
                "content": f"你是一个经验丰富的{language}开发者{framework_text}。请根据需求生成高质量、符合最佳实践的代码。"
            },
            {
                "role": "user",
                "content": f"请根据以下需求生成{language}代码{framework_text}:\n\n{requirement}\n\n请提供完整的、可运行的代码，并添加必要的注释。"
            }
        ]
        
        # 使用模型生成代码
        model_name = "gemma-3n-e4b-it"  # 使用更强大的模型以获得更好的代码质量
        response = await llm_service.send_llm_request(messages, model_name)
        
        if "choices" in response and response["choices"]:
            code_content = response["choices"][0]["message"].get("content", "")
            
            # 提取代码块
            code_match = re.search(r'```(?:\w+)?\s*([\s\S]*?)\s*```', code_content)
            code = code_match.group(1) if code_match else code_content
            
            # 提取解释（如果有）
            explanation = ""
            if code_match:
                # 尝试从代码块前后提取解释
                code_start = code_content.find("```")
                if code_start > 0:
                    explanation = code_content[:code_start].strip()
                
                code_end = code_content.rfind("```") + 3
                if code_end < len(code_content):
                    post_explanation = code_content[code_end:].strip()
                    explanation = (explanation + "\n\n" + post_explanation).strip()
            
            return {
                "success": True,
                "language": language,
                "framework": framework,
                "code": code,
                "explanation": explanation if explanation else None
            }
        else:
            return {
                "success": False,
                "error": "代码生成请求失败"
            }
    except Exception as e:
        logger.error(f"代码生成错误: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }
        
# MARK: 内容长度管理
async def ensure_content_length(
    content: str, 
    max_tokens: int = 6000, 
    context_description: str = "内容",
    force_truncate: bool = None  # None表示使用配置文件设置
) -> str:
    """
    确保内容长度不超过LLM处理的token限制
    
    Args:
        content: 原始内容
        max_tokens: 最大允许的token数量(近似值，按平均每个token 4个字符计算)
        context_description: 内容的描述，用于日志记录
        force_truncate: 是否强制截断而不使用AI整理（None=使用配置文件设置）
        
    Returns:
        处理后的内容，确保不会超过token限制
    """
    try:
        from app.core.config import get_settings
        settings = get_settings()
        
        # 如果没有明确指定，使用配置文件设置
        if force_truncate is None:
            force_truncate = settings.FORCE_CONTENT_TRUNCATE
        
        # 硬性限制：使用配置文件中的设置
        hard_limit_tokens = settings.MAX_CONTENT_HARD_LIMIT
        hard_limit_chars = hard_limit_tokens * 2
        
        if len(content) > hard_limit_chars:
            logger.warning(f"{context_description}长度({len(content)}字符)超过硬性限制，强制截断至{hard_limit_chars}字符")
            truncated = content[:hard_limit_chars] + f"\n\n[{context_description}超过硬性限制({hard_limit_tokens} tokens)，已强制截断]"
            return truncated
        
        # 粗略估计token数量（中文和英文字符的token计算有差异，这里用字符数/4作为近似）
        estimated_tokens = len(content) / 2
        
        # 如果估计的token数量超过限制
        if estimated_tokens > max_tokens:
            logger.info(f"{context_description}估计token数({int(estimated_tokens)})超过限制({max_tokens})")
            
            # 检查是否已经处理过
            if "[以下是经过整理的" in content or "[内容已安全截断]" in content or "[内容超过硬性限制" in content:
                logger.info(f"{context_description}已经经过处理，直接截断")
                max_safe_chars = max_tokens * 2
                truncated = content[:max_safe_chars] + f"\n\n[{context_description}已再次截断，原长度: {len(content)}字符]"
                return truncated
            
            # 根据配置选择处理方式
            if force_truncate:
                # 暴力截断模式
                max_safe_chars = max_tokens * 2
                truncated = content[:max_safe_chars] + f"\n\n[{context_description}已截断，原长度: {len(content)}字符，截断后: {len(content[:max_safe_chars])}字符]"
                logger.info(f"已暴力截断{context_description}至{len(truncated)}字符")
                return truncated
            else:
                # 智能整理模式（保留以备将来使用）
                try:
                    from app.services.llm_service import llm_service
                    
                    # 截断过长的输入，避免AI整理模型也超出限制
                    max_input_chars = 8000
                    truncated_content = content
                    if len(content) > max_input_chars:
                        truncated_content = content[:max_input_chars] + "...[内容已预截断]"
                    
                    # 构建提示词
                    messages = [
                        {
                            "role": "system",
                            "content": f"请提取以下{context_description}的核心要点和关键信息。保留最重要的事实、数据和观点，去除冗余内容。输出需精简，但必须保留原文的关键信息。目标是将内容精简到原来的1/3左右。"
                        },
                        {
                            "role": "user",
                            "content": truncated_content
                        }
                    ]
                    
                    # 使用较小的模型进行内容整理（跳过内容检查避免循环调用）
                    model_name = "gemma-3n-e4b-it"
                    response = await llm_service.send_llm_request(messages, model_name, skip_content_check=True)
                    
                    if "choices" in response and response["choices"]:
                        summarized_content = response["choices"][0]["message"].get("content", "")
                        
                        # 确保整理后的内容有意义
                        if summarized_content and len(summarized_content) > 100:
                            logger.info(f"成功整理{context_description}，原长度: {len(content)}字符，整理后: {len(summarized_content)}字符")
                            return f"[以下是经过整理的{context_description}]\n\n{summarized_content}\n\n[原内容长度: {len(content)}字符]"
                        
                    logger.warning(f"AI整理结果无效，回退到暴力截断")
                except Exception as e:
                    logger.error(f"使用AI整理内容时出错: {str(e)}，回退到暴力截断")
                
                # AI整理失败，回退到暴力截断
                max_safe_chars = max_tokens * 4
                truncated = content[:max_safe_chars] + f"\n\n[{context_description}AI整理失败，已截断，原长度: {len(content)}字符]"
                logger.info(f"已截断{context_description}至{len(truncated)}字符")
                return truncated
        
        # 内容长度在限制范围内，直接返回原内容
        return content
        
    except Exception as e:
        logger.error(f"内容长度管理出错: {str(e)}")
        # 出错时进行安全截断
        safe_length = 24000  # 约6000 tokens
        return content[:safe_length] + f"\n\n[内容长度管理出错，已安全截断至{safe_length}字符]"